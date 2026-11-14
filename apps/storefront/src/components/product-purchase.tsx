"use client";

import type { ProductDetail } from "@fluxkit/api-client";
import { Alert, Badge, PriceText, textStyles, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
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
  findVariant,
  initialSelection,
  selectedValueIds,
  selectionQuery,
  type Selection,
} from "../lib/variant-matcher";
import { useI18n } from "./i18n-provider";
import { useCart } from "./session-provider";
import { useCartDrawer } from "./cart-drawer-provider";
import { SelectedSkuProvider } from "./selected-sku";
import { StoreTrustBar } from "./trust-bar";
import { PHONE_QUERY, StickyBuyBar, useInView, useMediaQuery } from "./sticky-buy-bar";
import { focusRing } from "./styles";
import { ProductPurchaseGallery } from "./product-purchase-gallery";
import { ProductPurchaseForm, type AddStatus } from "./product-purchase-form";

const QUANTITY_LIMIT_KEY = "errors.rule.quantity_limit";
/** Reading time for the successful add label; unrelated to motion duration. */
export const PRODUCT_ADDED_MS = 2500;

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
  /** Server-rendered note under the trust bar (the delivery and returns note, `components/product-page-note.tsx`). */
  note?: ReactNode;
  /** Localized guide link next to the option pickers; absent means no link. */
  optionGuide?: { href: string; label: string } | null;
  /** Option values the address asks for (`?opt.<code>=<value>`, `selectionFromParams`); the page starts from them. */
  preferredSelection?: Selection;
  /** Called with every selection the shopper makes (the island keeps it in the address). */
  onSelectionChange?: (selection: Selection) => void;
  /** Quantity and stock hint per variant id in the cart (`cartLineFacts`); `null` or absent while the cart is not known. */
  cartLines?: ReadonlyMap<string, CartLineFacts> | null;
  /** Successful adds open the drawer with the exact inline or phone-bar button as its focus-return target. */
  onAdded?: (opener: HTMLElement | null) => void;
  /** Adds through the shared cart store; prices and counts remain server answers. */
  onAddToCart: (input: { variantId: string; quantity: number }) => Promise<
    | { status: "added" }
    /** Cart quantity freshly re-read after a quantity_limit answer; absent when no re-read was made. */
    | { status: "failed"; messageKey: string; cartQuantity?: number }
  >;
}

/** Purchase island state; API-driven options and variants, with an always-mounted status region for add outcomes. */
export function ProductPurchaseView({
  product,
  gallery,
  exponent,
  locale,
  t,
  brand,
  children,
  note,
  onAddToCart,
  onAdded,
  preferredSelection,
  onSelectionChange,
  cartLines = null,
  optionGuide = null,
}: ProductPurchaseViewProps) {
  const [selection, setSelection] = useState<Selection>(() =>
    initialSelection(product, preferredSelection),
  );
  const [quantity, setQuantity] = useState(MIN_LINE_QUANTITY);
  const [activeImage, setActiveImage] = useState(0);
  const [status, setStatus] = useState<AddStatus>({ state: "idle" });
  // False in the server HTML and until this island has hydrated: before that a tap on the buy button cannot reach `submit`
  // (the browser would post the form and reload the page with nothing added), so the button is disabled and looks it (UX
  // round 2, batch 3A item 6). Without a script it stays so and a `noscript` line says why (adding always needed one).
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  const formRef = useRef<HTMLFormElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const pendingOpener = useRef<HTMLButtonElement | null>(null);
  const inFlight = useRef(false);
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
  // One separator for the chosen values above the pickers and in the phone's buy bar (review m6 of PR 234).
  const chosen = selectionSummary(product, selection, t("product.bar.separator"));
  const barNote = !purchasable
    ? atLimit
      ? t("product.bar.atLimit", { count: inCart })
      : t(availability.messageKey)
    : chosen;

  useEffect(() => {
    if (status.state !== "added") return;
    const id = window.setTimeout(() => setStatus({ state: "idle" }), PRODUCT_ADDED_MS);
    return () => window.clearTimeout(id);
  }, [status]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (variant === null || !purchasable || inFlight.current) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const opener =
      pendingOpener.current ??
      (submitter instanceof HTMLElement ? submitter : addButtonRef.current);
    pendingOpener.current = null;
    const refusal = addQuantityRefusal(shownQuantity, inCart);
    if (refusal !== null) {
      setStatus({ state: "failed", messageKey: refusal.messageKey, values: refusal.values });
      return;
    }
    inFlight.current = true;
    setStatus({ state: "pending" });
    try {
      const outcome = await onAddToCart({ variantId: variant.id, quantity: shownQuantity });
      // The API's `quantity_limit` does not know what the shopper sees: name the cart's quantity, but only the one read
      // again after the refusal (the tab's own may be stale, PR 213 review m1); otherwise the API's text stays.
      const limit =
        outcome.status === "failed" && outcome.messageKey === QUANTITY_LIMIT_KEY
          ? quantityLimitRefusal(shownQuantity, outcome.cartQuantity)
          : null;
      if (outcome.status === "added") onAdded?.(opener);
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
    } finally {
      inFlight.current = false;
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
        <ProductPurchaseGallery
          current={current}
          images={images}
          activeImage={activeImage}
          title={product.title}
          t={t}
          onImage={setActiveImage}
        />

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

          <ProductPurchaseForm
            {...{
              product,
              t,
              locale,
              chosen,
              selection,
              optionGuide,
              otherOnSale,
              shownQuantity,
              room,
              pending,
              atLimit,
              purchasable,
              ready,
              soldOut,
              inCart,
              stock,
              status,
              formRef,
              addButtonRef,
            }}
            onSubmit={submit}
            onSelection={(next) => {
              setSelection(next);
              onSelectionChange?.(next);
              setActiveImage(0);
              setStatus({ state: "idle" });
            }}
            onQuantity={(next) => {
              setQuantity(next);
              if (status.state === "failed") setStatus({ state: "idle" });
            }}
          />
          <StoreTrustBar t={t} locale={locale} />
          {note}
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
          canAdd={purchasable && ready && !pending}
          state={pending ? "loading" : status.state === "added" ? "done" : "idle"}
          loadingLabel={t("product.adding")}
          doneLabel={t("product.card.added")}
          addLabel={soldOut ? t("availability.out_of_stock") : t("product.addToCart")}
          decreaseLabel={t("product.quantity.decrease")}
          increaseLabel={t("product.quantity.increase")}
          onQuantity={(next) => {
            setQuantity(next);
            if (status.state === "failed") setStatus({ state: "idle" });
          }}
          onAdd={(opener) => {
            pendingOpener.current = opener;
            formRef.current?.requestSubmit();
          }}
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
  const drawer = useCartDrawer();
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
      onAdded={drawer.open}
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
