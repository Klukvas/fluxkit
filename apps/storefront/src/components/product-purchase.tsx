"use client";

import type { ProductDetail } from "@fluxkit/api-client";
import {
  Alert,
  Badge,
  Button,
  OptionPicker,
  PriceText,
  QuantityInput,
  textStyles,
  type Locale,
  type Translator,
} from "@fluxkit/ui";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  MAX_LINE_QUANTITY,
  MIN_LINE_QUANTITY,
  addQuantityRefusal,
  addRoom,
  quantityLimitRefusal,
} from "../lib/add-to-cart";
import { cartLineFacts, type CartLineFacts } from "../lib/cart-model";
import { availabilityDisplay, canAddToCart } from "../lib/availability";
import { discountPercent } from "../lib/discount";
import { localizedHref } from "../lib/locale-path";
import { formatMoney } from "../lib/money";
import { buyBarShown, selectionSummary } from "../lib/mobile-ux";
import { galleryFor, type GalleryItem } from "../lib/product-media";
import {
  chosenValue,
  findVariant,
  hasOptionPicker,
  initialSelection,
  isValueAvailable,
  isValueSoldOut,
  selectValue,
  selectedValueIds,
  selectionQuery,
  type Selection,
} from "../lib/variant-matcher";
import { useI18n } from "./i18n-provider";
import { useCart } from "./session-provider";
import { StoreImage } from "./store-image";
import { CloseIcon } from "./icons";
import { SelectedSkuProvider } from "./selected-sku";
import { StoreTrustBar } from "./trust-bar";
import { PHONE_QUERY, StickyBuyBar, useInView, useMediaQuery } from "./sticky-buy-bar";
import { focusRing } from "./styles";

type AddStatus =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "added" }
  | { state: "failed"; messageKey: string; values?: Readonly<Record<string, number>> };

const QUANTITY_LIMIT_KEY = "errors.rule.quantity_limit";
const LIMIT_NOTE_ID = "product-quantity-limit";

type PurchaseProduct = Pick<
  ProductDetail,
  "id" | "title" | "options" | "variants" | "price" | "availability"
>;

export interface ProductPurchaseViewProps {
  product: PurchaseProduct;
  gallery: readonly GalleryItem[];
  exponent: number;
  locale: Locale;
  t: Translator;
  /** The brand and the locale-less path of the catalog filtered by it. */
  brand: { name: string; path: string } | null;
  /** Server-rendered content below the purchase block (description, specifications). */
  children?: ReactNode;
  /** Option values the address asks for (`?opt.<code>=<value>`, `selectionFromParams`); the page starts from them. */
  preferredSelection?: Selection;
  /** Called with every selection the shopper makes (the island keeps it in the address). */
  onSelectionChange?: (selection: Selection) => void;
  /** Quantity and stock hint per variant id in the cart (`cartLineFacts`); `null` or absent while the cart is not known. */
  cartLines?: ReadonlyMap<string, CartLineFacts> | null;
  /** Adds to the cart: the island passes the cart store's `add` (the answer replaces the shared cart and tells the header badge). */
  onAddToCart: (input: { variantId: string; quantity: number }) => Promise<
    | { status: "added" }
    /**
     * `cartQuantity`: the variant's quantity in the cart as the island READ IT AGAIN after a `quantity_limit` answer
     * (another tab may have changed it); absent when it was not re-read.
     */
    | { status: "failed"; messageKey: string; cartQuantity?: number }
  >;
}

/**
 * The product page's interactive block: gallery, title, price, availability, the option picker, quantity and the
 * add-to-cart button. Options and values come from the API (`product.options`), the variant from the pure matcher in
 * `lib/variant-matcher.ts`; nothing here knows what an option is called. The result of an add is announced through a
 * `role="status"` region that is always mounted (a live region only announces changes to a region that already exists).
 */
export function ProductPurchaseView({
  product,
  gallery,
  exponent,
  locale,
  t,
  brand,
  children,
  onAddToCart,
  preferredSelection,
  onSelectionChange,
  cartLines = null,
}: ProductPurchaseViewProps) {
  const [selection, setSelection] = useState<Selection>(() =>
    initialSelection(product, preferredSelection),
  );
  const [quantity, setQuantity] = useState(MIN_LINE_QUANTITY);
  const [activeImage, setActiveImage] = useState(0);
  const [status, setStatus] = useState<AddStatus>({ state: "idle" });
  // The "Added" toast is shown until it is dismissed, the choice changes or it times out (the cart badge keeps the count).
  const [toastOpen, setToastOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const toastRef = useRef<HTMLDivElement>(null);
  // The bar exists on phones only: no second, hidden copy of the price and the button on wider screens.
  const phone = useMediaQuery(PHONE_QUERY);
  const ctaInView = useInView(addButtonRef, phone);
  const footerInView = useInView("footer", phone) ?? false;
  // An address that asked for option values (a card link, a language switch) is rewritten once to the selection the page
  // actually starts from, so a value that matches nothing (`?opt.color=nope`) does not stay in it (PR 213 review m7).
  const addressReported = useRef(false);
  useEffect(() => {
    if (addressReported.current) return;
    addressReported.current = true;
    if (preferredSelection !== undefined && Object.keys(preferredSelection).length > 0) {
      onSelectionChange?.(selection);
    }
  }, [preferredSelection, onSelectionChange, selection]);

  const variant = findVariant(product, selection);
  const images = galleryFor(gallery, selectedValueIds(product, selection));
  const current = images[Math.min(activeImage, images.length - 1)] as GalleryItem;
  const shownAvailability = variant?.availability ?? product.availability;
  const availability = availabilityDisplay(shownAvailability);
  // What the cart already holds of this variant (review SQ-02) and its stock hint (plan 2026-11-03): the stepper offers
  // only the room left on the line, and nothing when the cart's line already holds more than the shop can sell.
  const { inCart, room, stock } = addRoom(
    variant === null ? undefined : cartLines?.get(variant.id),
  );
  const shownQuantity = Math.min(quantity, Math.max(MIN_LINE_QUANTITY, room));
  const atLimit = room === 0;
  const purchasable = variant !== null && canAddToCart(variant.availability) && !atLimit;
  const pending = status.state === "pending";
  const shownPrice =
    variant === null
      ? null
      : formatMoney(
          { amount: variant.price.amount, currency: variant.price.currency },
          exponent,
          locale,
        );
  const barNote = !purchasable
    ? atLimit
      ? t("product.bar.atLimit", { count: inCart })
      : t(availability.messageKey)
    : selectionSummary(product, selection, t("product.bar.separator"));

  useEffect(() => {
    // On a phone the toast covers the page: hidden after a while unless the shopper is in it (the cart badge keeps the
    // count). From `md` it is a line in place, as before, and stays.
    if (!toastOpen || !phone) return;
    const id = window.setTimeout(() => {
      if (!toastRef.current?.contains(document.activeElement)) setToastOpen(false);
    }, 8000);
    return () => window.clearTimeout(id);
  }, [toastOpen, phone]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (variant === null || !purchasable || pending) return;
    const refusal = addQuantityRefusal(shownQuantity, inCart);
    if (refusal !== null) {
      setStatus({ state: "failed", messageKey: refusal.messageKey, values: refusal.values });
      return;
    }
    setStatus({ state: "pending" });
    setToastOpen(false);
    try {
      const outcome = await onAddToCart({ variantId: variant.id, quantity: shownQuantity });
      // The API's `quantity_limit` does not know what the shopper sees: name the cart's quantity, but only the one read
      // again after the refusal (the tab's own may be stale, PR 213 review m1); otherwise the API's text stays.
      const limit =
        outcome.status === "failed" && outcome.messageKey === QUANTITY_LIMIT_KEY
          ? quantityLimitRefusal(shownQuantity, outcome.cartQuantity)
          : null;
      if (outcome.status === "added") setToastOpen(true);
      setStatus(
        outcome.status === "added"
          ? { state: "added" }
          : limit !== null
            ? { state: "failed", messageKey: limit.messageKey, values: limit.values }
            : { state: "failed", messageKey: outcome.messageKey },
      );
    } catch (error) {
      // The store reports every failure the shopper can act on as an outcome; a throw is a bug. Free the button, stay loud.
      setStatus({ state: "failed", messageKey: "errors.generic" });
      throw error;
    }
  }

  const discount =
    variant === null || variant.price.compareAtAmount === null
      ? null
      : discountPercent(variant.price.amount, variant.price.compareAtAmount);
  const soldOut = variant !== null && variant.availability === "out_of_stock";
  // "Choose another" only when another variant can be bought.
  const otherOnSale =
    soldOut && product.variants.some((other) => other.availability !== "out_of_stock");

  return (
    <>
      {/* Phones: gallery, summary, details. `md`: two columns, details below. From `lg` (review D-08): gallery and details on
          the left (7 of 12), the summary on the right (5 of 12), sticky while the left column scrolls. */}
      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-12 lg:gap-x-10">
        <div
          role="group"
          aria-label={t("product.gallery.label")}
          className="flex flex-col gap-3 lg:col-span-7"
        >
          <StoreImage
            key={current.src ?? "placeholder"}
            src={current.src}
            alt={current.alt ?? product.title}
            width={960}
            height={960}
            sizes="(min-width: 768px) 50vw, 100vw"
            eager
          />
          {images.length > 1 ? (
            <ul className="flex flex-wrap gap-2">
              {images.map((item, index) => (
                <li key={`${index}-${item.src ?? "placeholder"}`}>
                  <button
                    type="button"
                    aria-label={t("product.gallery.show", {
                      index: index + 1,
                      total: images.length,
                    })}
                    aria-pressed={index === activeImage}
                    onClick={() => setActiveImage(index)}
                    className={`block w-16 rounded-md border-2 ${index === activeImage ? "border-primary" : "border-border"} ${focusRing}`}
                  >
                    <StoreImage src={item.src} alt="" width={96} height={96} sizes="64px" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div
          data-product-summary=""
          className="fk-product-summary flex flex-col gap-4 lg:sticky lg:top-6 lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1 lg:self-start"
        >
          <h1 className={textStyles.pageTitle}>{product.title}</h1>
          {brand === null ? null : (
            <p className="text-muted-foreground">
              {t("product.brand")}{" "}
              <Link
                href={localizedHref(locale, brand.path)}
                className={`inline-flex min-h-6 items-center underline underline-offset-4 ${focusRing}`}
              >
                {brand.name}
              </Link>
            </p>
          )}

          {variant === null ? (
            <Alert variant="warning">{t("product.variantUnavailable")}</Alert>
          ) : variant.price.compareAtAmount === null ? (
            <PriceText
              className="text-2xl"
              price={formatMoney(
                { amount: variant.price.amount, currency: variant.price.currency },
                exponent,
                locale,
              )}
              priceLabel={t("product.price.label")}
            />
          ) : (
            <PriceText
              className="text-2xl"
              price={formatMoney(
                { amount: variant.price.amount, currency: variant.price.currency },
                exponent,
                locale,
              )}
              priceLabel={t("product.price.label")}
              compareAt={formatMoney(
                { amount: variant.price.compareAtAmount, currency: variant.price.currency },
                exponent,
                locale,
              )}
              compareAtLabel={t("product.compareAt.label")}
              discount={
                discount === null
                  ? null
                  : {
                      text: t("product.discount.badge", { percent: discount }),
                      label: t("product.discount.label", { percent: discount }),
                    }
              }
            />
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={availability.variant} id="product-availability">
              {t(availability.messageKey)}
            </Badge>
          </div>

          <form
            ref={formRef}
            method="post"
            onSubmit={submit}
            noValidate
            className="flex flex-col gap-4"
          >
            {hasOptionPicker(product)
              ? product.options.map((option) => (
                  <OptionPicker
                    key={option.id}
                    name={`${product.id}-${option.code}`}
                    legend={option.name}
                    values={option.values.map((value) => ({
                      value: value.code,
                      label: value.name,
                      disabled: !isValueAvailable(product, selection, option.code, value.code),
                      soldOut: isValueSoldOut(product, selection, option.code, value.code),
                    }))}
                    soldOutLabel={t("product.soldOut")}
                    selected={chosenValue(selection, option.code) ?? null}
                    onChange={(valueCode) => {
                      const next = selectValue(product, selection, option.code, valueCode);
                      setSelection(next);
                      onSelectionChange?.(next);
                      setActiveImage(0);
                      setStatus({ state: "idle" });
                      setToastOpen(false);
                    }}
                  />
                ))
              : null}
            {otherOnSale && hasOptionPicker(product) ? (
              <p className="text-sm text-muted-foreground">{t("product.soldOut.hint")}</p>
            ) : null}

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <QuantityInput
                  id="product-quantity"
                  label={t("product.quantity.label")}
                  decreaseLabel={t("product.quantity.decrease")}
                  increaseLabel={t("product.quantity.increase")}
                  min={MIN_LINE_QUANTITY}
                  max={Math.max(MIN_LINE_QUANTITY, room)}
                  value={shownQuantity}
                  onChange={(next) => {
                    setQuantity(next);
                    if (status.state === "failed") setStatus({ state: "idle" });
                  }}
                  disabled={pending || atLimit}
                />
                {/* Full width and 48 px on phones (review N8). While adding it stays enabled for the focus (`aria-disabled`,
                    review A1): a disabled button drops the keyboard focus to the page body; `submit` ignores a repeat. */}
                <Button
                  ref={addButtonRef}
                  type="submit"
                  disabled={!purchasable}
                  aria-disabled={pending}
                  className="min-h-12 w-full aria-disabled:opacity-50 sm:min-h-11 sm:w-auto lg:min-h-12 lg:flex-1"
                  aria-describedby={
                    atLimit ? `product-availability ${LIMIT_NOTE_ID}` : "product-availability"
                  }
                >
                  {pending
                    ? t("product.adding")
                    : soldOut
                      ? t("availability.out_of_stock")
                      : t("product.addToCart")}
                </Button>
              </div>
              {atLimit && stock !== null ? (
                <p id={LIMIT_NOTE_ID} className="flex flex-wrap gap-x-2 text-sm text-foreground">
                  <span>
                    {/* No count, or 0 (a default location without stock): "more than the shop has", never "only 0". */}
                    {stock.available === null || stock.available === 0
                      ? t("product.quantity.stockShort", { count: inCart })
                      : t.plural("product.quantity.stockLimit", stock.available, {
                          inCart,
                        })}
                  </span>
                  <Link
                    href={localizedHref(locale, "/cart")}
                    className={`inline-flex min-h-6 items-center underline underline-offset-4 ${focusRing}`}
                  >
                    {t("product.viewCart")}
                  </Link>
                </p>
              ) : atLimit ? (
                <p id={LIMIT_NOTE_ID} className="text-sm text-foreground">
                  {t("product.quantity.atLimit", {
                    count: inCart,
                    max: MAX_LINE_QUANTITY,
                    room: 0,
                  })}
                </p>
              ) : inCart > 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("product.quantity.inCart", { count: inCart })}
                </p>
              ) : null}
              <div role="status" className="flex flex-col gap-2">
                {status.state === "pending" ? <p>{t("product.adding")}</p> : null}
                {status.state === "added" ? (
                  // The confirmation as a toast (review D-02): on phones fixed under the sticky header, from `md` in place.
                  // It stays in this always mounted status region, so it is announced, and next in the tab order.
                  <div
                    ref={toastRef}
                    hidden={!toastOpen}
                    className="fk-toast z-40 items-center gap-3 rounded-lg border border-border bg-background p-3 text-foreground shadow-overlay max-md:fixed max-md:inset-x-4 max-md:top-20"
                  >
                    <span className="flex-1">{t("product.added")}</span>
                    <Link
                      href={localizedHref(locale, "/cart")}
                      className={`inline-flex min-h-11 items-center font-medium underline underline-offset-4 ${focusRing}`}
                    >
                      {t("product.viewCart")}
                    </Link>
                    <button
                      type="button"
                      aria-label={t("product.added.dismiss")}
                      onClick={() => setToastOpen(false)}
                      className={`inline-flex size-11 items-center justify-center rounded-md hover:bg-muted ${focusRing}`}
                    >
                      <CloseIcon />
                    </button>
                  </div>
                ) : null}
              </div>
              {status.state === "failed" ? (
                <Alert variant="danger">{t(status.messageKey, status.values)}</Alert>
              ) : null}
            </div>
          </form>
          <StoreTrustBar t={t} />
        </div>
        {children === undefined || children === null ? null : (
          <div className="md:col-span-2 lg:col-span-7 lg:col-start-1">
            <SelectedSkuProvider text={variant === null ? t("product.sku.none") : variant.sku}>
              {children}
            </SelectedSkuProvider>
          </div>
        )}
      </div>
      {phone ? (
        <StickyBuyBar
          visible={buyBarShown({ ctaInView, footerInView })}
          price={shownPrice}
          note={barNote}
          quantity={shownQuantity}
          min={MIN_LINE_QUANTITY}
          max={Math.max(MIN_LINE_QUANTITY, room)}
          canAdd={purchasable && !pending}
          addLabel={
            pending
              ? t("product.adding")
              : soldOut
                ? t("availability.out_of_stock")
                : t("product.addToCart")
          }
          decreaseLabel={t("product.quantity.decrease")}
          increaseLabel={t("product.quantity.increase")}
          onQuantity={(next) => {
            setQuantity(next);
            if (status.state === "failed") setStatus({ state: "idle" });
          }}
          onAdd={() => formRef.current?.requestSubmit()}
        />
      ) : null}
    </>
  );
}

/** The island: takes the translator from the page's provider and adds through the shared cart store. */
export function ProductPurchase(
  props: Omit<ProductPurchaseViewProps, "locale" | "t" | "onAddToCart" | "onSelectionChange">,
) {
  const { locale, t } = useI18n();
  const { state, store } = useCart();
  const { product } = props;
  // Only a new cart answer changes the quantities; busy marks and announcements do not.
  const cart = state.cart;
  const cartLines = useMemo(() => cartLineFacts(cart), [cart]);
  return (
    <ProductPurchaseView
      {...props}
      locale={locale}
      t={t}
      cartLines={cartLines}
      onSelectionChange={(selection) => {
        // The choice lives in the address (review SQ-05): a reload, a shared link and the language switch keep it. Next's
        // router follows `history.replaceState`, so the language links pick up the new query.
        const query = selectionQuery(product, selection);
        const url = `${window.location.pathname}${query === "" ? "" : `?${query}`}`;
        window.history.replaceState(null, "", url);
      }}
      onAddToCart={async ({ variantId, quantity }) => {
        const outcome = await store.add(variantId, quantity);
        if (outcome.status === "ok") return { status: "added" };
        const { messageKey } = outcome.failure;
        if (messageKey !== QUANTITY_LIMIT_KEY) return { status: "failed", messageKey };
        // Another tab may have changed the line: read the cart again before naming its quantity.
        const fresh = await store.refresh();
        if (fresh.status !== "ok") return { status: "failed", messageKey };
        const cartQuantity =
          fresh.cart.lines.find((line) => line.variantId === variantId)?.quantity ?? 0;
        return { status: "failed", messageKey, cartQuantity };
      }}
    />
  );
}
