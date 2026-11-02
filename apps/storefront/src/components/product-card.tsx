import type { ProductSummary } from "@fluxkit/api-client";
import { Badge, PriceText, VisuallyHidden, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { availabilityDisplay } from "../lib/availability";
import { allowedImageUrl } from "../lib/image-source";
import { localizedHref } from "../lib/locale-path";
import { formatMoney } from "../lib/money";
import type { CardOffer } from "../lib/search-facets";
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
}

const PRODUCT_OFFER: CardOffer = { kind: "product" };

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
}: ProductCardProps) {
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
  return (
    <article className="group relative flex h-full flex-col gap-2 rounded-lg border border-border bg-background p-3 transition-shadow hover:border-border-input hover:shadow-raised focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring motion-reduce:transition-none">
      <StoreImage
        src={allowedImageUrl(product.image?.url, imageHosts)}
        alt={product.image?.alt ?? product.title}
        width={480}
        height={480}
        sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
        eager={eager}
      />
      {product.brand === null ? null : brandPath === null ? (
        <p className="text-sm text-muted-foreground">{product.brand.name}</p>
      ) : (
        // A small meta line, not a second button (review D-07). A 24 px target with a mouse; on a touch screen not a target of
        // its own (review N5): a tap there opens the product (the card's link lies under it). Keyboards and screen readers
        // still reach the brand link.
        <Link
          href={localizedHref(locale, brandPath)}
          className={`relative z-10 inline-flex min-h-6 w-fit items-center rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline pointer-coarse:pointer-events-none ${focusRing}`}
        >
          {product.brand.name}
        </Link>
      )}
      <Heading className="line-clamp-2 font-medium text-foreground">
        <Link
          href={href}
          className="after:absolute after:inset-0 group-hover:underline group-hover:underline-offset-4 focus-visible:outline-none"
        >
          {product.title}
        </Link>
      </Heading>
      {/* Pushed to the bottom: in a row of equal-height cards the prices share one line whatever the titles' length. */}
      <div className="mt-auto flex flex-col gap-1 pt-1">
        {note === null ? null : <p className="text-sm text-muted-foreground">{note}</p>}
        <PriceText
          price={listPriceLabel(price, exponent, locale, t)}
          priceLabel={t("product.price.label")}
        />
        {availability !== null && !badgeShown ? (
          <VisuallyHidden>{t(availability.messageKey)}</VisuallyHidden>
        ) : null}
      </div>
      {availability !== null && badgeShown ? (
        // Over the image's corner (after the title in reading order): the text column keeps one shape on every card.
        <Badge
          variant={availability.variant}
          className="pointer-events-none absolute top-5 left-5 w-fit shadow-card"
        >
          {t(availability.messageKey)}
        </Badge>
      ) : null}
    </article>
  );
}
