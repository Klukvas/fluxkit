import type { CatalogQuery } from "./catalog-query";
import {
  resolveSearchAddress,
  type RawSearchParams,
  type SearchAddress,
  type SearchQuery,
} from "./search-query";

/**
 * The address of the catalog and category pages while search is on (plan 2026-10-29-search.md, section 9, owner answer 3),
 * as pure functions. Pure.
 *
 * Decisions, each with a test:
 * - The URL state is the results page's (`search-query.ts`): `f`, `price`, `sort` and `page`, the same names, values and
 *   canonical form, so a filter link means the same on `/search`, `/catalog` and `/c/<slug>`. Words are not: a `q` with text
 *   redirects to `/search` with the words and filters (words belong there; review SQ-04 replaced the 404); an empty `q` (the
 *   script-less form) redirects away like any non-canonical form.
 * - `?brand=<slug>` stays an accepted alias of `f=brand:<slug>` without a redirect: product pages and shared links of the
 *   SQL listing use it, and the address keeps working when search is switched off again. A brand that is not a slug is
 *   dropped by a redirect (review SQ-04; it was a 404).
 * - On a category page the path is the category: a `category:` facet in the address would be OR-ed with it by the API
 *   (values of one key are OR) and widen the page, so it is dropped by a redirect (review SQ-04; it was a 404). The page
 *   filters by the path's category id itself.
 * - Only the unfiltered list may enter the Next data cache (category, page and sort are bounded; a facet value or a price
 *   is free text the visitor chooses, the reason `GET /store/products?brand=` is not cached either).
 * - The SQL fallback keeps what `GET /store/products` can apply (category, one brand, the page) and reports whether
 *   anything else was asked for, so the page can say the filters were not applied.
 */

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 160;
const BRAND_PREFIX = "brand:";
const CATEGORY_PREFIX = "category:";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isSlug(text: string): boolean {
  return text.length <= MAX_SLUG_LENGTH && SLUG.test(text);
}

function withBrand(query: SearchQuery, brand: string | null): SearchQuery {
  if (brand === null) return query;
  const entry = `${BRAND_PREFIX}${brand}`;
  return query.facets.includes(entry) ? query : { ...query, facets: [...query.facets, entry] };
}

/**
 * What a catalog or category route does with an address while search is on: list, redirect (also the cleaned form of a bad
 * address, review SQ-04), explain a box, or send words to the results page (`words`: the route redirects to `/search` with
 * them and the filters).
 */
export function resolveCatalogAddress(
  raw: RawSearchParams,
  exponent: number,
  options: { categoryPage: boolean },
): SearchAddress | { kind: "words"; query: SearchQuery } {
  const rawBrand = first(raw["brand"]);
  let brand: string | null = null;
  // A brand alias that is not a slug is dropped (the redirect shows the list without it).
  const brandDropped = rawBrand !== undefined && rawBrand !== "" && !isSlug(rawBrand);
  if (rawBrand !== undefined && rawBrand !== "" && !brandDropped) brand = rawBrand;
  const rest = Object.fromEntries(Object.entries(raw).filter(([name]) => name !== "brand"));
  const address = resolveSearchAddress(rest, exponent);
  if (address.kind === "malformed") return address;
  if (address.query.q !== "") return { kind: "words", query: withBrand(address.query, brand) };
  // On a category page the path is the category: a `category:` facet would widen the list, so it is dropped.
  const facets = options.categoryPage
    ? address.query.facets.filter((entry) => !entry.startsWith(CATEGORY_PREFIX))
    : address.query.facets;
  const query = withBrand({ ...address.query, facets }, brand);
  if (address.kind === "form_error") return { ...address, query };
  const dropped = brandDropped || facets.length !== address.query.facets.length;
  return { kind: "query", query, canonical: address.canonical && !dropped };
}

/** The query sent to `GET /store/search`: a category page adds its category, by id. */
export function catalogSearchRequest(query: SearchQuery, categoryId: string | null): SearchQuery {
  return categoryId === null
    ? query
    : { ...query, facets: [...query.facets, `${CATEGORY_PREFIX}${categoryId}`] };
}

/** Whether the read may enter the Next data cache: no facet and no price (both are values the visitor chooses). */
export function isCacheableCatalogSearch(query: SearchQuery): boolean {
  return query.facets.length === 0 && query.price === null;
}

/**
 * The SQL listing's query for a catalog address (search unavailable): the page and a single brand. `dropped` is true when
 * the address asked for something the SQL listing cannot apply (another facet, several brands, a price, a sort).
 */
export function fallbackCatalogQuery(query: SearchQuery): {
  query: CatalogQuery;
  dropped: boolean;
} {
  const brands = query.facets.filter((entry) => entry.startsWith(BRAND_PREFIX));
  const only = brands.length === 1 ? (brands[0] ?? "").slice(BRAND_PREFIX.length) : null;
  const brand = only !== null && isSlug(only) ? only : null;
  const kept = brand === null ? 0 : 1;
  return {
    query: { page: query.page, brand },
    dropped: query.facets.length > kept || query.price !== null || query.sort !== null,
  };
}
