import type { ProductSummary } from "@fluxkit/api-client";
import type { Locale, Translator } from "@fluxkit/ui";
import type { CardOffer } from "../lib/search-facets";
import { ProductCard } from "./product-card";

/** Cards whose image loads at once: roughly the first row; the rest are lazy. */
export const EAGER_IMAGE_COUNT = 4;

export function ProductGrid<Item extends ProductSummary>({
  products,
  locale,
  t,
  exponent,
  imageHosts,
  headingLevel,
  brandPathFor,
  label,
  offerFor,
  eagerCount = EAGER_IMAGE_COUNT,
}: {
  products: readonly Item[];
  locale: Locale;
  t: Translator;
  exponent: number;
  imageHosts: readonly string[];
  headingLevel: "h2" | "h3";
  /** Locale-less path of the list filtered by a brand slug (the catalog or the current category). */
  brandPathFor: (brandSlug: string) => string;
  /** Accessible name of the list. */
  label: string;
  /** What each card shows of its search item's `match` (`cardOffer`); absent: every card is the product's own. */
  offerFor?: (product: Item) => CardOffer;
  /** How many leading images load at once (the first row of a list page); 0 below other content (the home page). */
  eagerCount?: number;
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
            eager={index < eagerCount}
            offer={offerFor?.(product)}
          />
        </li>
      ))}
    </ul>
  );
}
