/**
 * Paging and filter parameters of the catalog and category pages, and the links that carry them. Pure.
 *
 * Decisions (plan, step 5): the page size is 24 (`GET /store/products` default); the API refuses `offset` above 10 000, so
 * the last reachable page is `floor(10000 / pageSize) + 1`; a malformed or out-of-range `page`, and a `brand` that is not a
 * slug, are NOT FOUND (404), never silently page 1; the brand filter exists only as links (`?brand=`), there is no brand list.
 */

export const CATALOG_PAGE_SIZE = 24;

/** `offset` maximum of the store list routes (docs/api/catalog.md, "Lists and pagination"). */
export const MAX_API_OFFSET = 10_000;

export interface CatalogQuery {
  page: number;
  /** A brand slug, or `null` for no filter. */
  brand: string | null;
}

export type CatalogQueryResult = { ok: true; query: CatalogQuery } | { ok: false };

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 160;
const PAGE_DIGITS = /^[1-9][0-9]{0,5}$/;

/** The last page whose first item still has an `offset` the API accepts. */
export function maxPage(pageSize: number): number {
  return Math.floor(MAX_API_OFFSET / pageSize) + 1;
}

export function offsetForPage(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}

/** Pages that exist for `total` items, never more than the offset cap allows; 0 for an empty list. */
export function pageCountFor(total: number, pageSize: number): number {
  return Math.min(Math.ceil(total / pageSize), maxPage(pageSize));
}

/** Page 1 always exists (an empty list shows an empty state); a later page must hold items. */
export function isPageInRange(page: number, total: number, pageSize: number): boolean {
  return page === 1 || page <= pageCountFor(total, pageSize);
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseCatalogQuery(
  search: Readonly<Record<string, string | string[] | undefined>>,
): CatalogQueryResult {
  const rawPage = first(search.page);
  let page = 1;
  if (rawPage !== undefined) {
    if (!PAGE_DIGITS.test(rawPage)) return { ok: false };
    page = Number(rawPage);
    if (page > maxPage(CATALOG_PAGE_SIZE)) return { ok: false };
  }
  const rawBrand = first(search.brand);
  let brand: string | null = null;
  if (rawBrand !== undefined && rawBrand !== "") {
    if (rawBrand.length > MAX_SLUG_LENGTH || !SLUG.test(rawBrand)) return { ok: false };
    brand = rawBrand;
  }
  return { ok: true, query: { page, brand } };
}

/**
 * The query of an address with a bad `page` or `brand` repaired (review SQ-04, 2026-11-02; the SQL listing's twin of
 * `sanitizeSearchParams`): a page that is not a whole number from 1 is page 1, a page past the offset cap is the last
 * reachable page, a brand that is not a slug is no filter. `canonical` is false when the address is not exactly what
 * `catalogPath` writes for it, and the route redirects there. A page past the last page of the list is only known after
 * the read (`beyond_last_page` of `loadCatalogListing`).
 */
export function normalizeCatalogQuery(
  search: Readonly<Record<string, string | string[] | undefined>>,
): {
  query: CatalogQuery;
  canonical: boolean;
} {
  const rawPage = first(search.page);
  const number = rawPage !== undefined && /^\d{1,15}$/.test(rawPage) ? Number(rawPage) : 1;
  const page = Math.min(Math.max(number, 1), maxPage(CATALOG_PAGE_SIZE));
  const rawBrand = first(search.brand);
  const brand =
    rawBrand !== undefined && rawBrand.length <= MAX_SLUG_LENGTH && SLUG.test(rawBrand)
      ? rawBrand
      : null;
  const query = { page, brand };
  const written = new URLSearchParams(catalogPath("", query).split("?")[1] ?? "");
  const incoming = (name: "page" | "brand") => {
    const value = search[name];
    return value === undefined ? [] : Array.isArray(value) ? value : [value];
  };
  const canonical = (["page", "brand"] as const).every((name) => {
    const sent = incoming(name);
    const wanted = written.getAll(name);
    return sent.length === wanted.length && sent.every((value, index) => value === wanted[index]);
  });
  return { query, canonical };
}

/** Locale-less path with the query, for `localizedHref`: brand first, then page; page 1 and no brand are left out. */
export function catalogPath(
  base: string,
  options: { page?: number; brand?: string | null },
): string {
  const page = options.page ?? 1;
  if (!Number.isInteger(page) || page < 1) {
    throw new RangeError("A page number must be a whole number from 1.");
  }
  const parts: string[] = [];
  if (options.brand) parts.push(`brand=${encodeURIComponent(options.brand)}`);
  if (page > 1) parts.push(`page=${page}`);
  return parts.length === 0 ? base : `${base}?${parts.join("&")}`;
}
