import type { ProductSummary } from "@fluxkit/api-client";
import type { BadgeVariant, Locale, Translator } from "@fluxkit/ui";
import { availabilityDisplay, canAddToCart } from "./availability";
import { allowedImageUrl } from "./image-source";
import { localizedHref } from "./locale-path";
import { formatMoney } from "./money";
import type { CardOffer } from "./search-facets";

/**
 * The plain view model of a product card (plan 2026-11-08-design-changeability.md, L2). Pure. Every card kind of the registry
 * (`components/cards/registry.ts`, a fork's `cards/custom.ts`) renders THIS, never the API's list item: what a card shows
 * (which price, which link, whether availability is a badge) is decided here once, so a redesigned card cannot get it wrong.
 * Plain data only (strings, numbers, `null`): no API object, no function, no React element.
 */
export interface ProductCardModel {
  /** The product id (a stable React key). */
  id: string;
  title: string;
  /** The product page, localized; a search hit's link carries its matching options (`opt.<code>=<value>`). */
  href: string;
  /** `src` is an allowed URL (`IMAGE_HOSTS`) or `null` for the placeholder; `alt` is never empty (the title by default). */
  image: { src: string | null; alt: string };
  /** `href` is the localized list filtered by the brand, or `null` to show the brand as text; no brand: `null`. */
  brand: { name: string; href: string | null } | null;
  /** The price text: one price, or "from <lowest>" when the variants differ. */
  price: string;
  /** Spoken before the price. */
  priceLabel: string;
  /** A search hit's note ("3 matching options", "depends on the option"), else `null`. */
  note: string | null;
  /**
   * The availability text; `badge` is true only for an exception (low stock, out of stock: review D-15), the in-stock state
   * stays text for assistive technology. `null` while the search index catches up (no availability is claimed).
   */
  availability: { text: string; variant: BadgeVariant; badge: boolean } | null;
  /**
   * What the card offers to buy (owner design 2026-11-13), always next to the product link, never inside it:
   * - `add`: the product's only sellable variant (`defaultVariantId` of the API), added to the cart from the card;
   * - `choose`: several variants, so a link to the product page (`href`, with a search hit's options) where one is chosen;
   *   `label` is its translated text;
   * - `null`: nothing to buy here: the shown availability is out of stock, or unknown while the search index catches up.
   */
  purchase: CardPurchase;
}

export type CardPurchase =
  { kind: "add"; variantId: string } | { kind: "choose"; label: string } | null;

/** The price of a list item: one price, or "from <lowest>" when the variants differ. */
export function listPriceLabel(
  price: ProductSummary["price"],
  exponent: number,
  locale: string,
  t: Translator,
): string {
  const lowest = formatMoney({ amount: price.from, currency: price.currency }, exponent, locale);
  return price.from === price.to ? lowest : t("catalog.price.from", { price: lowest });
}

export interface CardDisplayInput {
  product: ProductSummary;
  locale: Locale;
  t: Translator;
  /** Digits of the shop currency. */
  exponent: number;
  /** Hosts `next/image` may load from (`IMAGE_HOSTS`). */
  imageHosts: readonly string[];
  /** Locale-less path that filters by this product's brand, or `null` to show the brand as plain text. */
  brandPath: string | null;
  /**
   * What the card shows of a search item's `match` (`cardOffer` of `lib/search-facets.ts`): the matching variants' price,
   * availability and link, or the neutral note while the index catches up. Absent: the product's own (catalog, home, SQL
   * fallback).
   */
  offer?: CardOffer;
}

const PRODUCT_OFFER: CardOffer = { kind: "product" };

/** The view model of one list item (extends `cardOffer` and `listPriceLabel`; the list item has no compare-at price). */
export function cardDisplay({
  product,
  locale,
  t,
  exponent,
  imageHosts,
  brandPath,
  offer = PRODUCT_OFFER,
}: CardDisplayInput): ProductCardModel {
  const shown =
    offer.kind === "product"
      ? product.availability
      : offer.kind === "matched"
        ? offer.availability
        : null;
  const display = shown === null ? null : availabilityDisplay(shown);
  const purchase: CardPurchase =
    shown === null || !canAddToCart(shown)
      ? null
      : product.defaultVariantId === null
        ? { kind: "choose", label: t("product.card.chooseOptions") }
        : { kind: "add", variantId: product.defaultVariantId };
  const price = offer.kind === "matched" ? offer.price : product.price;
  const path = localizedHref(locale, `/p/${encodeURIComponent(product.slug)}`);
  const linkQuery = offer.kind === "product" ? "" : offer.linkQuery;
  const note =
    offer.kind === "catchingUp"
      ? t("search.card.dependsOnOption")
      : offer.kind === "matched" && offer.variantCount > 1
        ? t.plural("search.card.matchingOptions", offer.variantCount)
        : null;
  return {
    id: product.id,
    title: product.title,
    href: linkQuery === "" ? path : `${path}?${linkQuery}`,
    image: {
      src: allowedImageUrl(product.image?.url, imageHosts),
      alt: product.image?.alt ?? product.title,
    },
    brand:
      product.brand === null
        ? null
        : {
            name: product.brand.name,
            href: brandPath === null ? null : localizedHref(locale, brandPath),
          },
    price: listPriceLabel(price, exponent, locale, t),
    priceLabel: t("product.price.label"),
    note,
    availability:
      display === null
        ? null
        : {
            text: t(display.messageKey),
            variant: display.variant,
            badge: shown !== "in_stock",
          },
    purchase,
  };
}
