import type { Availability, ProductDetail } from "@fluxkit/api-client";
import { minorUnitsToDecimalString } from "./money";

/**
 * Metadata and structured data helpers (plan, "SEO"). Pure: the pages pass in the public origin, the exponent and the data.
 * Nothing here reads the environment or the API.
 */

/** `origin` has no trailing slash (`loadStorefrontEnv`); `path` starts with exactly one slash. */
export function absoluteUrl(origin: string, path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new RangeError("A site path must start with one slash.");
  }
  return `${origin}${path}`;
}

export interface LanguageAlternatesInput {
  origin: string;
  locale: string;
  locales: readonly string[];
  defaultLocale: string;
  /** Path after the locale, with an optional `?page=` query, for example `""`, `/catalog` or `/c/shoes?page=2`. Never a brand. */
  path: string;
}

export interface LanguageAlternates {
  canonical: string;
  /** hreflang to URL, one entry per locale plus `x-default` (the default locale's URL). */
  languages: Record<string, string>;
}

export function languageAlternates(input: LanguageAlternatesInput): LanguageAlternates {
  const query = input.path.split("?")[1];
  if (query !== undefined && new URLSearchParams(query).has("brand")) {
    // The canonical of a filtered view is the unfiltered one; a caller that passes the filter has a bug.
    throw new RangeError("A canonical or hreflang URL must not carry the brand filter.");
  }
  const urlFor = (locale: string): string => absoluteUrl(input.origin, `/${locale}${input.path}`);
  const languages: Record<string, string> = {};
  for (const locale of input.locales) languages[locale] = urlFor(locale);
  languages["x-default"] = urlFor(input.defaultLocale);
  return { canonical: urlFor(input.locale), languages };
}

/**
 * Robots directive of a catalog or category listing, or `undefined` for the indexable default. Page 1 without a filter is
 * indexable; a brand-filtered view and every later page are `noindex, follow` (their products are reachable from page 1,
 * the category pages and the sitemap).
 */
export function listingRobots(query: {
  page: number;
  brand: string | null;
}): { index: false; follow: true } | undefined {
  return query.brand !== null || query.page > 1 ? { index: false, follow: true } : undefined;
}

/** Plain text for a meta description: whitespace collapsed, cut at a word boundary (never inside a code point). */
export function trimDescription(text: string | null | undefined, max = 160): string | undefined {
  const collapsed = (text ?? "").replace(/\s+/g, " ").trim();
  if (collapsed === "") return undefined;
  if (collapsed.length <= max) return collapsed;
  let kept = "";
  for (const character of collapsed) {
    if (kept.length + character.length > max - 1) break;
    kept += character;
  }
  const lastSpace = kept.lastIndexOf(" ");
  const atWord = lastSpace > 0 && collapsed[kept.length] !== " " ? kept.slice(0, lastSpace) : kept;
  return `${atWord.trimEnd().replace(/[,;:.\-–—]+$/, "")}…`;
}

/**
 * JSON for an inline `<script type="application/ld+json">`. `JSON.stringify` leaves `</script>` intact, which would let
 * product text end the element and inject markup, so `<`, `>` and `&` become unicode escapes (JSON.parse gives back the
 * same value), as do the two line separators that JavaScript treats as newlines.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const SCHEMA_AVAILABILITY: Record<Availability, string> = {
  in_stock: "https://schema.org/InStock",
  low_stock: "https://schema.org/LimitedAvailability",
  out_of_stock: "https://schema.org/OutOfStock",
};

export function schemaAvailability(availability: Availability): string {
  return SCHEMA_AVAILABILITY[availability];
}

export function breadcrumbJsonLd(items: readonly { name: string; url: string }[]): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export interface ProductJsonLdInput {
  product: ProductDetail;
  /** Absolute canonical URL of the product page. */
  url: string;
  /** `currencyExponent` of `GET /store/config`. */
  exponent: number;
  /** Absolute image URLs. */
  images: readonly string[];
  /** Already trimmed plain text. */
  description: string | undefined;
}

/**
 * schema.org `Product`. Prices are decimal STRINGS made from the integer minor units with BigInt arithmetic
 * (`minorUnitsToDecimalString`), never a float. One price is an `Offer`; a range is an `AggregateOffer`.
 */
export function productJsonLd(input: ProductJsonLdInput): object {
  const { product } = input;
  const { from, to, currency } = product.price;
  const offers =
    from === to
      ? {
          "@type": "Offer",
          url: input.url,
          price: minorUnitsToDecimalString(from, input.exponent),
          priceCurrency: currency,
          availability: schemaAvailability(product.availability),
        }
      : {
          "@type": "AggregateOffer",
          url: input.url,
          lowPrice: minorUnitsToDecimalString(from, input.exponent),
          highPrice: minorUnitsToDecimalString(to, input.exponent),
          priceCurrency: currency,
          offerCount: product.variants.length,
          availability: schemaAvailability(product.availability),
        };
  const onlyVariant = product.variants.length === 1 ? product.variants[0] : undefined;
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    url: input.url,
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.images.length === 0 ? {} : { image: [...input.images] }),
    ...(onlyVariant === undefined ? {} : { sku: onlyVariant.sku }),
    ...(product.brand === null ? {} : { brand: { "@type": "Brand", name: product.brand.name } }),
    offers,
  };
}
