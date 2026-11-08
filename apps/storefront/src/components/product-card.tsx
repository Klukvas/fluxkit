import type { ProductSummary } from "@fluxkit/api-client";
import { Badge, PriceText, VisuallyHidden, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { availabilityDisplay } from "../lib/availability";
import { allowedImageUrl } from "../lib/image-source";
import { localizedHref } from "../lib/locale-path";
import { formatMoney } from "../lib/money";
import type { CardOffer } from "../lib/search-facets";
import { HeartIcon } from "./icons";
import { StoreImage } from "./store-image";
import { focusRing } from "./styles";

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

export interface ProductCardProps {
  product: ProductSummary;
  locale: Locale;
  t: Translator;
  exponent: number;
  /** Hosts `next/image` may load from (`IMAGE_HOSTS`). */
  imageHosts: readonly string[];
  /** Locale-less path that filters by this product's brand, or `null` to show the brand as plain text. */
  brandPath: string | null;
  /** Heading level of the product title: the card sits under an h1 (`h2`) or under a section's h2 (`h3`). */
  headingLevel: "h2" | "h3";
  /** First row of a list: its image is not lazy. */
  eager?: boolean;
  /**
   * What the card shows of a search item's `match` (`cardOffer` of `lib/search-facets.ts`): the matching variants' price,
   * availability and link, or the neutral note while the index catches up. Absent: the product's own (catalog, home,
   * SQL fallback).
   */
  offer?: CardOffer;
  /**
   * Show the "Sale" badge. TODO(fluxkit): no caller can set it truthfully yet: `ProductSummary` (list item of
   * `GET /store/products` and `/store/search`) carries no compare-at price, so this needs an API change first.
   */
  onSale?: boolean;
}

export const PRODUCT_OFFER: CardOffer = { kind: "product" };

/**
 * What any card variant shows of a list item and its search `offer` (reshape experiment: extracted from `ProductCard` so the
 * list card does not copy it): availability, price text, link and the note.
 */
export function cardDisplay(
  product: ProductSummary,
  offer: CardOffer,
  locale: Locale,
  t: Translator,
  exponent: number,
) {
  const shown =
    offer.kind === "product"
      ? product.availability
      : offer.kind === "matched"
        ? offer.availability
        : null;
  const availability = shown === null ? null : availabilityDisplay(shown);
  const price = offer.kind === "matched" ? offer.price : product.price;
  const path = localizedHref(locale, `/p/${encodeURIComponent(product.slug)}`);
  const linkQuery = offer.kind === "product" ? "" : offer.linkQuery;
  const href = linkQuery === "" ? path : `${path}?${linkQuery}`;
  const note =
    offer.kind === "catchingUp"
      ? t("search.card.dependsOnOption")
      : offer.kind === "matched" && offer.variantCount > 1
        ? t.plural("search.card.matchingOptions", offer.variantCount)
        : null;
  // Only an exception earns a visible badge (review D-15): "In stock" on every card was noise. The in-stock state stays in the
  // card's text for assistive technology.
  const badgeShown = availability !== null && shown !== "in_stock";
  return {
    availability,
    badgeShown,
    priceText: listPriceLabel(price, exponent, locale, t),
    href,
    note,
  };
}

/**
 * One product in a list. The whole card is one click target (the title link stretches over it); the brand link sits above
 * that layer so it stays separately clickable. Everything shown comes from the list item: price, availability, brand. The
 * list item has no compare-at price and no variant count, so a card shows no discount and no swatch hint (no API change in
 * design batch A).
 */
export function ProductCard({
  product,
  locale,
  t,
  exponent,
  imageHosts,
  brandPath,
  headingLevel: Heading,
  eager = false,
  offer = PRODUCT_OFFER,
  onSale = false,
}: ProductCardProps) {
  const { availability, badgeShown, priceText, href, note } = cardDisplay(
    product,
    offer,
    locale,
    t,
    exponent,
  );
  // Reshape experiment (client request 1): a 4:5 portrait frame on top, the price as a pill over its bottom-left corner, the
  // sale badge and a favourite placeholder over its top-right corner. The overlays share the frame's grid cell
  // (`row-start-1 col-start-1`) but come after the title in the markup, so the reading order stays title, then price.
  return (
    <article className="group relative grid h-full content-start gap-2 rounded-lg border border-border bg-background p-3 transition-shadow hover:border-border-input hover:shadow-raised focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring motion-reduce:transition-none">
      <div className="col-start-1 row-start-1 aspect-4/5 overflow-hidden rounded-lg bg-muted">
        <StoreImage
          src={allowedImageUrl(product.image?.url, imageHosts)}
          alt={product.image?.alt ?? product.title}
          width={480}
          height={600}
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
          eager={eager}
          fill
          className="transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none"
        />
      </div>
      {product.brand === null ? null : brandPath === null ? (
        <p className="text-xs tracking-wider text-muted-foreground uppercase">
          {product.brand.name}
        </p>
      ) : (
        // A small meta line, not a second button (review D-07). A 24 px target with a mouse; on a touch screen not a target of
        // its own (review N5): a tap there opens the product (the card's link lies under it). Keyboards and screen readers
        // still reach the brand link.
        <Link
          href={localizedHref(locale, brandPath)}
          className={`relative z-10 inline-flex min-h-6 w-fit items-center rounded-sm text-xs tracking-wider text-muted-foreground uppercase underline-offset-4 hover:text-foreground hover:underline pointer-coarse:pointer-events-none ${focusRing}`}
        >
          {product.brand.name}
        </Link>
      )}
      {/* The full title as a tooltip where two lines cut it (review m5 of PR 217); on the heading, not the link, so the
          link's name is not repeated as its description. */}
      <Heading className="line-clamp-2 font-medium text-foreground" title={product.title}>
        <Link
          href={href}
          className="after:absolute after:inset-0 group-hover:underline group-hover:underline-offset-4 focus-visible:outline-none"
        >
          {product.title}
        </Link>
      </Heading>
      {note === null ? null : <p className="text-sm text-muted-foreground">{note}</p>}
      {availability !== null && !badgeShown ? (
        <VisuallyHidden>{t(availability.messageKey)}</VisuallyHidden>
      ) : null}
      {/* The price pill over the frame's bottom-left corner. */}
      <div className="pointer-events-none col-start-1 row-start-1 m-2 self-end justify-self-start rounded-full bg-background px-3 py-1 shadow-card">
        <PriceText price={priceText} priceLabel={t("product.price.label")} />
      </div>
      {/* Top-left: the stock exception; top-right: the sale badge and the favourite placeholder. */}
      {availability !== null && badgeShown ? (
        <Badge
          variant={availability.variant}
          className="pointer-events-none col-start-1 row-start-1 m-2 w-fit self-start justify-self-start shadow-card"
        >
          {t(availability.messageKey)}
        </Badge>
      ) : null}
      <div className="col-start-1 row-start-1 m-2 flex items-center gap-2 self-start justify-self-end">
        {onSale ? (
          <Badge variant="danger" className="pointer-events-none shadow-card">
            {t("catalog.card.sale")}
          </Badge>
        ) : null}
        {/* TODO(fluxkit): UI placeholder only. There is no wishlist feature (no package, no API, no flag); a real one
            belongs in `packages/features/wishlist` behind `features.wishlist.enabled`, and this button would be its slot. */}
        <button
          type="button"
          aria-label={t("catalog.card.favourite", { title: product.title })}
          className={`relative z-10 inline-flex size-11 items-center justify-center rounded-full bg-background text-foreground shadow-card hover:text-danger ${focusRing}`}
        >
          <HeartIcon width="20" height="20" />
        </button>
      </div>
    </article>
  );
}
