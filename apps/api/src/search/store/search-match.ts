import {
  buildSearchFilterDocuments,
  matchesSearchSelection,
  type Availability,
  type SearchSelection,
} from "@fluxkit/core";
import {
  buildContextFor,
  type SearchDefinitions,
  type SearchProductRecord,
} from "../indexer/index.js";
import type { StoreSearchMatch } from "./store-search.schemas.js";

/** Best first, as the item's own availability (`summarizeProduct`): in stock, then low stock, then out of stock. */
const AVAILABILITY_RANK: Readonly<Record<Availability, number>> = {
  in_stock: 2,
  low_stock: 1,
  out_of_stock: 0,
};

/**
 * `match` of a search item (plan 2026-11-02-api-matched-variant-and-stock-hints): the sellable variants of the product
 * whose filter fields fit the selection, from CURRENT Postgres facts (`readSearchProducts`) and the same filter fields the
 * index holds (core `buildSearchFilterDocuments`), so a price or a stock bit never comes from the index. `null` when no
 * variant fits any more (the index is behind). The representative is the best available, then the cheapest, then the
 * first in the product's variant order. Option values are codes, sorted by option code. Never a SKU or a quantity.
 */
export function matchOfProduct(
  record: SearchProductRecord,
  selection: SearchSelection,
  definitions: SearchDefinitions,
  shopCurrency: string,
): StoreSearchMatch | null {
  // The locale only changes texts, which the filter fields do not hold.
  const context = buildContextFor(definitions, record.productTypeId, "und", "und");
  const matching = new Set(
    buildSearchFilterDocuments(record.facts, context)
      .filter((document) => matchesSearchSelection(document, selection))
      .map((document) => document.id),
  );
  // `readSearchProducts` lists the variants in the product's order (position, id): ties keep the first.
  const variants = record.facts.variants.flatMap((variant) =>
    matching.has(variant.id) && variant.shopPrice !== null
      ? [{ variant, price: variant.shopPrice }]
      : [],
  );
  const [first, ...rest] = variants;
  if (first === undefined) {
    return null;
  }
  let best = first;
  let from = first.price;
  let to = first.price;
  for (const candidate of rest) {
    from = Math.min(from, candidate.price);
    to = Math.max(to, candidate.price);
    const rank = AVAILABILITY_RANK[candidate.variant.availability];
    const bestRank = AVAILABILITY_RANK[best.variant.availability];
    if (rank > bestRank || (rank === bestRank && candidate.price < best.price)) {
      best = candidate;
    }
  }
  return {
    variantId: best.variant.id,
    variantCount: variants.length,
    price: { from, to, currency: shopCurrency },
    availability: best.variant.availability,
    optionValues: [...best.variant.optionValues]
      .sort((a, b) => (a.optionCode < b.optionCode ? -1 : a.optionCode > b.optionCode ? 1 : 0))
      .map((pair) => ({ optionCode: pair.optionCode, valueCode: pair.valueCode })),
  };
}
