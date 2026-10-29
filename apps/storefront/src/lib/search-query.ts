import type { SearchSort } from "@fluxkit/api-client";
import { decimalToMinorUnits } from "./search-money";

/**
 * The URL state of the search results page, as pure functions (plan 2026-10-29-search.md, section 9). The address is the
 * state: `?q=<words>&f=<facetKey>:<value>&f=...&price=<min>..<max>&sort=<sort>&page=<n>`, the names `GET /store/search`
 * takes, so a result can be shared and the back button works. Every change of the selection goes back to page 1.
 *
 * Decisions, each with a test:
 * - A malformed parameter is refused (the page answers 404), never silently dropped or replaced: a shared link must show
 *   what it says. Unknown parameters (`utm_source`) are ignored.
 * - The API's rules are checked here only as far as they cost nothing and cannot drift: shape, lengths and the 50 values.
 *   Whether a facet key exists is the API's answer (`unknown_facet_key`, a 400 the page explains).
 * - The no-script submit of the filter form sends major units (`priceMin=12.50`) and ranges (`rmin.<key>`); the page turns
 *   them into the canonical address and redirects (`isCanonicalSearch`), so the form works before hydration.
 * - Prices are minor units in the address and integers in memory; the boxes show major units (`search-money.ts`).
 */

/** Hits per page asked of the API (its default; `limit` is not sent). */
export const SEARCH_PAGE_SIZE = 24;
/** The API refuses a first hit at 10 000 or later (`beyond_max_offset`): the last reachable page. */
export const MAX_SEARCH_PAGE = Math.floor(9_999 / SEARCH_PAGE_SIZE) + 1;
/** The engine pages through at most this many hits (`pagination.maxTotalHits`): the API's `total` stops here. */
export const SEARCH_RESULT_CAP = 10_000;
/** The API's cap on values of `f` (docs/api/search.md). */
export const MAX_FACET_VALUES = 50;
const MAX_Q_CODE_POINTS = 200;

export const SEARCH_SORTS: readonly SearchSort[] = [
  "relevance",
  "newest",
  "price_asc",
  "price_desc",
];

export interface SearchPrice {
  /** Minor units; `null` is an open end. */
  min: number | null;
  max: number | null;
}

export interface SearchQuery {
  /** What the shopper typed, trimmed. Empty means browsing. */
  q: string;
  /** `<facetKey>:<value>` entries in the order they were chosen. */
  facets: readonly string[];
  price: SearchPrice | null;
  /** `null` is the API's default (relevance with words, newest without). */
  sort: SearchSort | null;
  page: number;
}

export type SearchParseResult = { ok: true; query: SearchQuery } | { ok: false; reason: string };

export type RawSearchParams = Readonly<Record<string, string | string[] | undefined>>;

const FACET_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const PRICE = /^(\d{0,15})\.\.(\d{0,15})$/;
const PAGE = /^[1-9]\d{0,5}$/;
const RANGE_NUMBER = /^-?\d{1,15}(?:\.\d{1,10})?$/;

/** A control character (C0, DEL, C1): the API refuses them in `q`, and they have no place in a facet value. */
function hasControlCharacter(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** `<facetKey>:<value>`: a key of the API's shape, a value of 1 to 200 characters without a space or a control character. */
function isFacetEntry(entry: string): boolean {
  const colon = entry.indexOf(":");
  if (colon < 1) return false;
  const value = entry.slice(colon + 1);
  return (
    FACET_KEY.test(entry.slice(0, colon)) &&
    value.length >= 1 &&
    value.length <= 200 &&
    !/\s/.test(value) &&
    !hasControlCharacter(value)
  );
}

function all(value: string | string[] | undefined): string[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function first(value: string | string[] | undefined): string | undefined {
  return all(value)[0];
}

/** The sort the API would pick anyway is not written into the address. */
function normalizeSort(sort: SearchSort | null, q: string): SearchSort | null {
  if (sort === null) return null;
  if (q === "") return sort === "newest" || sort === "relevance" ? null : sort;
  return sort === "relevance" ? null : sort;
}

export function facetEntry(key: string, code: string): string {
  return `${key}:${code}`;
}

/** The box's number as text, `null` for an empty or missing box, `undefined` for text that is not a plain decimal. */
function parseRangeBox(text: string | undefined): string | null | undefined {
  const clean = (text ?? "").trim().replace(",", ".");
  if (clean === "") return null;
  return RANGE_NUMBER.test(clean) ? clean : undefined;
}

/**
 * The query of an address (or of the filter form's entries, see `parseSearchForm`). `exponent` is the shop currency's digits,
 * for the major-unit price boxes of a script-less submit.
 */
export function parseSearchParams(raw: RawSearchParams, exponent: number): SearchParseResult {
  const q = (first(raw["q"]) ?? "").trim();
  if ([...q].length > MAX_Q_CODE_POINTS) return { ok: false, reason: "q_too_long" };
  if (hasControlCharacter(q)) return { ok: false, reason: "q_control_characters" };

  const facets: string[] = [];
  for (const entry of all(raw["f"])) {
    if (!isFacetEntry(entry)) return { ok: false, reason: "facet" };
    if (!facets.includes(entry)) facets.push(entry);
  }
  if (facets.length > MAX_FACET_VALUES) return { ok: false, reason: "too_many_facets" };

  let price: SearchPrice | null = null;
  const rawPrice = first(raw["price"]);
  if (rawPrice !== undefined) {
    const match = PRICE.exec(rawPrice);
    if (match === null || (match[1] === "" && match[2] === ""))
      return { ok: false, reason: "price" };
    price = {
      min: match[1] === "" ? null : Number(match[1]),
      max: match[2] === "" ? null : Number(match[2]),
    };
    if (price.min !== null && price.max !== null && price.min > price.max) {
      return { ok: false, reason: "price" };
    }
  }

  // The script-less filter form: major units in two boxes that win over `price` (a cleared box clears the filter).
  if (raw["priceMin"] !== undefined || raw["priceMax"] !== undefined) {
    const read = (text: string | undefined): number | null | undefined => {
      const clean = (text ?? "").trim();
      return clean === "" ? null : (decimalToMinorUnits(clean, exponent) ?? undefined);
    };
    const min = read(first(raw["priceMin"]));
    const max = read(first(raw["priceMax"]));
    if (min === undefined) return { ok: false, reason: "price_min" };
    if (max === undefined) return { ok: false, reason: "price_max" };
    if (min !== null && max !== null && min > max) return { ok: false, reason: "price_order" };
    price = min === null && max === null ? null : { min, max };
  }

  let kept = facets;
  const rangeKeys = new Set(
    Object.keys(raw)
      .filter((name) => name.startsWith("rmin.") || name.startsWith("rmax."))
      .map((name) => name.slice(5)),
  );
  for (const key of rangeKeys) {
    if (!FACET_KEY.test(key)) return { ok: false, reason: "facet" };
    const min = parseRangeBox(first(raw[`rmin.${key}`]));
    const max = parseRangeBox(first(raw[`rmax.${key}`]));
    if (min === undefined || max === undefined) return { ok: false, reason: `range:${key}` };
    if (min !== null && max !== null && Number(min) > Number(max)) {
      return { ok: false, reason: `range:${key}` };
    }
    kept = kept.filter((entry) => !entry.startsWith(`${key}:`));
    if (min !== null || max !== null) kept.push(`${key}:${min ?? ""}..${max ?? ""}`);
  }
  if (kept.length > MAX_FACET_VALUES) return { ok: false, reason: "too_many_facets" };

  let sort: SearchSort | null = null;
  const rawSort = first(raw["sort"]);
  if (rawSort !== undefined && rawSort !== "") {
    if (!SEARCH_SORTS.includes(rawSort as SearchSort)) return { ok: false, reason: "sort" };
    sort = rawSort as SearchSort;
  }

  let page = 1;
  const rawPage = first(raw["page"]);
  if (rawPage !== undefined) {
    if (!PAGE.test(rawPage) || Number(rawPage) > MAX_SEARCH_PAGE)
      return { ok: false, reason: "page" };
    page = Number(rawPage);
  }

  return { ok: true, query: { q, facets: kept, price, sort: normalizeSort(sort, q), page } };
}

/** The entries of a submit of the filter form, as the query it asks for (always page 1). */
export function parseSearchForm(
  entries: Iterable<readonly [string, string]>,
  exponent: number,
): SearchParseResult {
  const raw: Record<string, string[]> = {};
  for (const [name, value] of entries) {
    if (name === "page") continue;
    (raw[name] ??= []).push(value);
  }
  return parseSearchParams(raw, exponent);
}

function encode(value: string): string {
  return encodeURIComponent(value);
}

/**
 * The locale-less path of a query, ready for `localizedHref`: `q`, `f`, `price`, `sort`, `page`, defaults left out. Every
 * value is escaped, so typed text cannot end the address or add a parameter.
 */
export function searchPath(query: SearchQuery, base = "/search"): string {
  const parts: string[] = [];
  if (query.q !== "") parts.push(`q=${encode(query.q)}`);
  for (const entry of query.facets) parts.push(`f=${encode(entry)}`);
  if (query.price !== null) {
    parts.push(`price=${query.price.min ?? ""}..${query.price.max ?? ""}`);
  }
  if (query.sort !== null) parts.push(`sort=${query.sort}`);
  if (query.page > 1) parts.push(`page=${String(query.page)}`);
  return parts.length === 0 ? base : `${base}?${parts.join("&")}`;
}

const KNOWN_PARAMS = /^(q|f|price|sort|page|priceMin|priceMax|rmin\..*|rmax\..*)$/;

/**
 * Whether the address is exactly what `searchPath` writes for its query (unknown parameters aside). The page redirects to
 * the short form otherwise (a form submit, `page=1`, an empty `sort`, padded text), so every state has one address.
 */
export function isCanonicalSearch(raw: RawSearchParams, query: SearchQuery): boolean {
  const incoming = Object.entries(raw)
    .filter(([name]) => KNOWN_PARAMS.test(name))
    .flatMap(([name, value]) => all(value).map((entry) => `${name}=${entry}`))
    .sort();
  const written = [...new URLSearchParams(searchPath(query).split("?")[1] ?? "").entries()]
    .map(([name, value]) => `${name}=${value}`)
    .sort();
  return (
    incoming.length === written.length && incoming.every((entry, index) => entry === written[index])
  );
}

export function isFacetSelected(query: SearchQuery, key: string, code: string): boolean {
  return query.facets.includes(facetEntry(key, code));
}

export function toggleFacet(query: SearchQuery, key: string, code: string): SearchQuery {
  const entry = facetEntry(key, code);
  const facets = query.facets.includes(entry)
    ? query.facets.filter((existing) => existing !== entry)
    : [...query.facets, entry];
  return { ...query, facets, page: 1 };
}

/** The min and max texts of the selected range of a number attribute, or `null` when none is selected. */
export function rangeOf(query: SearchQuery, key: string): { min: string; max: string } | null {
  const entry = query.facets.find(
    (candidate) => candidate.startsWith(`${key}:`) && candidate.includes(".."),
  );
  if (entry === undefined) return null;
  const [min = "", max = ""] = entry.slice(key.length + 1).split("..");
  return { min, max };
}

export function setRange(
  query: SearchQuery,
  key: string,
  min: number | string | null,
  max: number | string | null,
): SearchQuery {
  const facets = query.facets.filter((entry) => !entry.startsWith(`${key}:`));
  if (min !== null || max !== null)
    facets.push(`${key}:${min === null ? "" : String(min)}..${max === null ? "" : String(max)}`);
  return { ...query, facets, page: 1 };
}

export function setPrice(query: SearchQuery, price: SearchPrice | null): SearchQuery {
  const open = price === null || (price.min === null && price.max === null);
  return { ...query, price: open ? null : price, page: 1 };
}

export function setSort(query: SearchQuery, sort: SearchSort | null): SearchQuery {
  return { ...query, sort, page: 1 };
}

/** Drops the facets and the price; the words and the sort stay. */
export function clearFilters(query: SearchQuery): SearchQuery {
  return { ...query, facets: [], price: null, page: 1 };
}

export function setPage(query: SearchQuery, page: number): SearchQuery {
  if (!Number.isInteger(page) || page < 1 || page > MAX_SEARCH_PAGE) {
    throw new RangeError(
      `A search page must be a whole number from 1 to ${String(MAX_SEARCH_PAGE)}.`,
    );
  }
  return { ...query, page };
}
