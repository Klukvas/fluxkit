import type { ProductSummary } from "@fluxkit/api-client";
import type { Locale, Translator } from "@fluxkit/ui";
import type { CardMatch } from "../lib/search-facets";
import { ProductCard } from "./product-card";

/** Cards whose image loads at once: roughly the first row; the rest are lazy. */
export const EAGER_IMAGE_COUNT = 4;

export function ProductGrid({
  products,
  locale,
  t,
  exponent,
  imageHosts,
  headingLevel,
  brandPathFor,
  label,
  match = null,
}: {
  products: readonly ProductSummary[];
  locale: Locale;
  t: Translator;
  exponent: number;
  imageHosts: readonly string[];
  headingLevel: "h2" | "h3";
  /** Locale-less path of the list filtered by a brand slug (the catalog or the current category). */
  brandPathFor: (brandSlug: string) => string;
  /** Accessible name of the list. */
  label: string;
  /** Variant-level filters of the list (`cardMatch`), `null` for none. */
  match?: CardMatch | null;
}) {
  return (
    <ul aria-label={label} className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
      {products.map((product, index) => (
        <li key={product.id}>
          <ProductCard
            product={product}
            locale={locale}
            t={t}
            exponent={exponent}
            imageHosts={imageHosts}
            brandPath={product.brand === null ? null : brandPathFor(product.brand.slug)}
            headingLevel={headingLevel}
            eager={index < EAGER_IMAGE_COUNT}
            match={match}
          />
        </li>
      ))}
    </ul>
  );
}
