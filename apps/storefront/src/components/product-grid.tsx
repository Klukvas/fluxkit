import type { ProductSummary } from "@fluxkit/api-client";
import type { Locale, Translator } from "@fluxkit/ui";
import { cardDisplay } from "../lib/product-card-model";
import type { CardOffer } from "../lib/search-facets";
import { resolveCard, type builtInCards } from "./cards/registry";

/** Cards whose image loads at once: roughly the first row; the rest are lazy (a kind may allow fewer, `maxEagerImages`). */
export const EAGER_IMAGE_COUNT = 4;

/**
 * A list of product cards. Each list item becomes a plain view model (`cardDisplay`) and is rendered by the card of `kind`
 * from the card registry (`cards/registry.ts`): `grid` by default, `list` for `?view=list`, or a kind a fork registered.
 */
export function ProductGrid<Item extends ProductSummary>({
  products,
  kind = "grid",
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
  /** The card kind of the registry; an unknown kind renders the grid card and logs an error. */
  kind?: keyof typeof builtInCards | (string & {});
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
  const { Card, listClassName, maxEagerImages } = resolveCard(kind);
  const eager = Math.min(eagerCount, maxEagerImages);
  return (
    <ul aria-label={label} className={listClassName}>
      {products.map((product, index) => {
        const offer = offerFor?.(product);
        const card = cardDisplay({
          product,
          locale,
          t,
          exponent,
          imageHosts,
          brandPath: product.brand === null ? null : brandPathFor(product.brand.slug),
          ...(offer === undefined ? {} : { offer }),
        });
        return (
          <li key={card.id}>
            <Card
              card={card}
              headingLevel={headingLevel}
              eager={index < eager}
              locale={locale}
              t={t}
            />
          </li>
        );
      })}
    </ul>
  );
}
