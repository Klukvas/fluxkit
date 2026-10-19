import type { ProductSummary } from "@fluxkit/api-client";
import { Badge, PriceText, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { availabilityDisplay } from "../lib/availability";
import { allowedImageUrl } from "../lib/image-source";
import { localizedHref } from "../lib/locale-path";
import { formatMoney } from "../lib/money";
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
}

/**
 * One product in a list. The whole card is one click target (the title link stretches over it); the brand link sits above
 * that layer so it stays separately clickable. Everything shown comes from the list item: price, availability, brand.
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
}: ProductCardProps) {
  const availability = availabilityDisplay(product.availability);
  return (
    <article className="relative flex h-full flex-col gap-2 rounded-lg border border-border bg-background p-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
      <StoreImage
        src={allowedImageUrl(product.image?.url, imageHosts)}
        alt={product.image?.alt ?? product.title}
        width={480}
        height={480}
        sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
        eager={eager}
      />
      <Heading className="font-medium text-foreground">
        <Link
          href={localizedHref(locale, `/p/${encodeURIComponent(product.slug)}`)}
          className="after:absolute after:inset-0 focus-visible:outline-none"
        >
          {product.title}
        </Link>
      </Heading>
      {product.brand === null ? null : brandPath === null ? (
        <p className="text-sm text-muted-foreground">{product.brand.name}</p>
      ) : (
        <Link
          href={localizedHref(locale, brandPath)}
          className={`relative z-10 w-fit text-sm text-muted-foreground underline underline-offset-4 ${focusRing}`}
        >
          {product.brand.name}
        </Link>
      )}
      <PriceText
        price={listPriceLabel(product.price, exponent, locale, t)}
        priceLabel={t("product.price.label")}
      />
      <Badge variant={availability.variant} className="w-fit">
        {t(availability.messageKey)}
      </Badge>
    </article>
  );
}
