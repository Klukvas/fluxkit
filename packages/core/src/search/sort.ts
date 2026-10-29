import { SEARCH_FIELDS, SORTABLE_FIELDS } from "./fields.js";

/** The public sort names of the search routes (ADR 0034 decision 10). Engine syntax is never accepted from clients. */
export const SEARCH_SORTS = ["relevance", "newest", "price_asc", "price_desc"] as const;

export type SearchSort = (typeof SEARCH_SORTS)[number];

/**
 * The sort of a request: `relevance` by default with a text query, `newest` without one (nothing to rank by), and
 * `relevance` without a query means `newest`. Returns null for a name that is not one of the four.
 */
export function parseSearchSort(raw: string | undefined, hasQuery: boolean): SearchSort | null {
  if (raw === undefined || raw === "") {
    return hasQuery ? "relevance" : "newest";
  }
  const sort = SEARCH_SORTS.find((candidate) => candidate === raw);
  if (sort === undefined) {
    return null;
  }
  return sort === "relevance" && !hasQuery ? "newest" : sort;
}

/**
 * The engine sort rules for a public sort name; `undefined` keeps the engine's relevance ranking. `newest` is the SQL
 * listing's `published_at desc, id desc` (review F2 of the search finish): the product id breaks ties, but only when the
 * live index can sort by it (`sortable`: its applied `sortableAttributes`), so an index built before document version 2
 * keeps answering until the rebuild swaps it.
 */
export function engineSort(
  sort: SearchSort,
  sortable: readonly string[] = SORTABLE_FIELDS,
): string[] | undefined {
  switch (sort) {
    case "relevance":
      return undefined;
    case "newest":
      return sortable.includes(SEARCH_FIELDS.productId)
        ? ["publishedAt:desc", "productId:desc"]
        : ["publishedAt:desc"];
    case "price_asc":
      return ["price:asc"];
    case "price_desc":
      return ["price:desc"];
  }
}
