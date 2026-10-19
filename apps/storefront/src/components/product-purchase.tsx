"use client";

import type { ProductDetail } from "@fluxkit/api-client";
import {
  Alert,
  Badge,
  Button,
  OptionPicker,
  PriceText,
  QuantityInput,
  type Locale,
  type Translator,
} from "@fluxkit/ui";
import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { MAX_LINE_QUANTITY, MIN_LINE_QUANTITY } from "../lib/add-to-cart";
import { availabilityDisplay, canAddToCart } from "../lib/availability";
import { localizedHref } from "../lib/locale-path";
import { formatMoney } from "../lib/money";
import { galleryFor, type GalleryItem } from "../lib/product-media";
import {
  findVariant,
  hasOptionPicker,
  initialSelection,
  isValueAvailable,
  selectValue,
  selectedValueIds,
  type Selection,
} from "../lib/variant-matcher";
import { useI18n } from "./i18n-provider";
import { useCart } from "./session-provider";
import { StoreImage } from "./store-image";
import { focusRing } from "./styles";

type AddStatus =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "added" }
  | { state: "failed"; messageKey: string };

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
  /** Adds to the cart: the island passes the cart store's `add` (the answer replaces the shared cart and tells the header badge). */
  onAddToCart: (input: {
    variantId: string;
    quantity: number;
  }) => Promise<{ status: "added" } | { status: "failed"; messageKey: string }>;
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
}: ProductPurchaseViewProps) {
  const [selection, setSelection] = useState<Selection>(() => initialSelection(product));
  const [quantity, setQuantity] = useState(MIN_LINE_QUANTITY);
  const [activeImage, setActiveImage] = useState(0);
  const [status, setStatus] = useState<AddStatus>({ state: "idle" });

  const variant = findVariant(product, selection);
  const images = galleryFor(gallery, selectedValueIds(product, selection));
  const current = images[Math.min(activeImage, images.length - 1)] as GalleryItem;
  const shownAvailability = variant?.availability ?? product.availability;
  const availability = availabilityDisplay(shownAvailability);
  const purchasable = variant !== null && canAddToCart(variant.availability);
  const pending = status.state === "pending";

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (variant === null || !purchasable || pending) return;
    setStatus({ state: "pending" });
    try {
      const outcome = await onAddToCart({ variantId: variant.id, quantity });
      setStatus(
        outcome.status === "added"
          ? { state: "added" }
          : { state: "failed", messageKey: outcome.messageKey },
      );
    } catch (error) {
      // The store reports every failure the shopper can act on as an outcome; a throw is a bug. Free the button, stay loud.
      setStatus({ state: "failed", messageKey: "errors.generic" });
      throw error;
    }
  }

  return (
    <>
      <div className="grid gap-8 md:grid-cols-2">
        <div role="group" aria-label={t("product.gallery.label")} className="flex flex-col gap-3">
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

        <div className="flex flex-col gap-4">
          <h1 className="text-3xl font-bold text-foreground">{product.title}</h1>
          {brand === null ? null : (
            <p className="text-muted-foreground">
              {t("product.brand")}{" "}
              <Link
                href={localizedHref(locale, brand.path)}
                className={`underline underline-offset-4 ${focusRing}`}
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
            />
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={availability.variant} id="product-availability">
              {t(availability.messageKey)}
            </Badge>
            {variant === null ? null : (
              <span className="text-sm text-muted-foreground">
                {t("product.sku", { sku: variant.sku })}
              </span>
            )}
          </div>

          <form method="post" onSubmit={submit} noValidate className="flex flex-col gap-4">
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
                    }))}
                    selected={selection[option.code] ?? null}
                    onChange={(valueCode) => {
                      setSelection(selectValue(product, selection, option.code, valueCode));
                      setActiveImage(0);
                      setStatus({ state: "idle" });
                    }}
                  />
                ))
              : null}

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <QuantityInput
                  id="product-quantity"
                  label={t("product.quantity.label")}
                  decreaseLabel={t("product.quantity.decrease")}
                  increaseLabel={t("product.quantity.increase")}
                  min={MIN_LINE_QUANTITY}
                  max={MAX_LINE_QUANTITY}
                  value={quantity}
                  onChange={setQuantity}
                  disabled={pending}
                />
                <Button
                  type="submit"
                  disabled={!purchasable || pending}
                  aria-describedby="product-availability"
                >
                  {pending ? t("product.adding") : t("product.addToCart")}
                </Button>
              </div>
              <div role="status" className="flex flex-col gap-2">
                {status.state === "pending" ? <p>{t("product.adding")}</p> : null}
                {status.state === "added" ? (
                  <p className="flex flex-wrap items-center gap-3 text-foreground">
                    <span>{t("product.added")}</span>
                    <Link
                      href={localizedHref(locale, "/cart")}
                      className={`underline underline-offset-4 ${focusRing}`}
                    >
                      {t("product.viewCart")}
                    </Link>
                  </p>
                ) : null}
              </div>
              {status.state === "failed" ? (
                <Alert variant="danger">{t(status.messageKey)}</Alert>
              ) : null}
            </div>
          </form>
        </div>
      </div>
      {children}
    </>
  );
}

/** The island: takes the translator from the page's provider and adds through the shared cart store. */
export function ProductPurchase(
  props: Omit<ProductPurchaseViewProps, "locale" | "t" | "onAddToCart">,
) {
  const { locale, t } = useI18n();
  const { store } = useCart();
  return (
    <ProductPurchaseView
      {...props}
      locale={locale}
      t={t}
      onAddToCart={async ({ variantId, quantity }) => {
        const outcome = await store.add(variantId, quantity);
        return outcome.status === "ok"
          ? { status: "added" }
          : { status: "failed", messageKey: outcome.failure.messageKey };
      }}
    />
  );
}
