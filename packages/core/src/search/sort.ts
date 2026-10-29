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

/** The engine sort rules for a public sort name; `undefined` keeps the engine's relevance ranking. */
export function engineSort(sort: SearchSort): string[] | undefined {
  switch (sort) {
    case "relevance":
      return undefined;
    case "newest":
      return ["publishedAt:desc"];
    case "price_asc":
      return ["price:asc"];
    case "price_desc":
      return ["price:desc"];
  }
}
