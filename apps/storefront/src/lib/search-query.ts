import type { SearchSort } from "@fluxkit/api-client";
import { isCardView, storedView, type CardView } from "./card-view";
import { decimalToMinorUnits } from "./search-money";

/**
 * The URL state of the search results page, as pure functions (plan 2026-10-29-search.md, section 9). The address is the
 * state: `?q=<words>&f=<facetKey>:<value>&f=...&price=<min>..<max>&sort=<sort>&page=<n>`, the names `GET /store/search`
 * takes, so a result can be shared and the back button works. Every change of the selection goes back to page 1.
 *
 * Decisions, each with a test:
 * - `parseSearchParams` refuses a malformed parameter; the route first cleans the address (`sanitizeSearchParams`: drop,
 *   clamp, truncate) and REDIRECTS to the cleaned address, so a shared link still shows what its address says, without a
 *   "page not found" for a typo (review SQ-04, 2026-11-02, replacing the earlier 404). Unknown parameters (`utm_source`)
 *   are ignored.
 * - The API's rules are checked here only as far as they cost nothing and cannot drift: shape, lengths and the 50 values.
 *   Whether a facet key exists is the API's answer (`unknown_facet_key`, a 400 the page explains).
 * - The no-script submit of the filter form sends major units (`priceMin=12.50`) and ranges (`rmin.<key>`); the page turns
 *   them into the canonical address and redirects (`isCanonicalSearch`), so the form works before hydration.
 * - Prices are minor units in the address and integers in memory; the boxes show major units (`search-money.ts`).
 * - `view=list` (`card-view.ts`) is presentation only: kept by every link of the page and by the filter form (a hidden field),
 *   never sent to the API (`search-data.ts` sends the named fields) and never in a canonical URL; an unknown value is dropped
 *   by the same redirect.
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
  /** How the list is shown (`?view=`); absent is the default grid, which is never written into the address. */
  view?: CardView;
}

export type SearchParseResult = { ok: true; query: SearchQuery } | { ok: false; reason: string };

export type RawSearchParams = Readonly<Record<string, string | string[] | undefined>>;

const FACET_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const PRICE = /^(\d{0,15})\.\.(\d{0,15})$/;
const PAGE = /^[1-9]\d{0,5}$/;
const RANGE_NUMBER = /^-?\d{1,15}(?:\.\d{1,10})?$/;
/**
 * Core's rules for a number of a range filter (`DECIMAL_PATTERN` and `MAX_FILTER_NUMBER` of
 * `packages/core/src/search/patterns.ts`; `search-query.spec.ts` compares them with core's source): the API refuses a
 * number JavaScript prints with an exponent (`0.0000001` is `1e-7`) as `invalid_range`, so a box is refused here first.
 */
export const RANGE_DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/;
export const MAX_RANGE_NUMBER = 1e15;

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

/**
 * The box's number as text, `null` for an empty or missing box, `undefined` for text that is not a plain decimal or a
 * number the API would refuse (review F4: the same test as core's `parseSelectionParams`).
 */
function parseRangeBox(text: string | undefined): string | null | undefined {
  const clean = (text ?? "").trim().replace(",", ".");
  if (clean === "") return null;
  if (!RANGE_NUMBER.test(clean)) return undefined;
  // `+ 0` turns -0 into 0, as core does before it prints the number.
  const value = Number(clean) + 0;
  return Math.abs(value) <= MAX_RANGE_NUMBER && RANGE_DECIMAL_PATTERN.test(String(value))
    ? clean
    : undefined;
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

  let view: CardView | undefined;
  const rawView = first(raw["view"]);
  if (rawView !== undefined && rawView !== "") {
    if (!isCardView(rawView)) return { ok: false, reason: "view" };
    view = storedView(rawView);
  }

  return {
    ok: true,
    query: {
      q,
      facets: kept,
      price,
      sort: normalizeSort(sort, q),
      page,
      ...(view === undefined ? {} : { view }),
    },
  };
}

/** `q` as the API takes it: control characters removed, trimmed, at most 200 code points (review SQ-04). */
function cleanWords(text: string): string {
  const kept = [...text]
    .filter((character) => !hasControlCharacter(character))
    .join("")
    .trim();
  return [...kept].slice(0, MAX_Q_CODE_POINTS).join("").trim();
}

/**
 * The shared parameters of an address with everything the parser would refuse dropped or clamped (review SQ-04,
 * 2026-11-02; it replaces "a malformed parameter is a 404"): `q` cleaned (`cleanWords`), malformed or repeated `f` entries
 * dropped (at most 50 kept), a malformed `price` or unknown `sort` dropped, `page` dropped unless it is a whole number and
 * capped at the last reachable page, an unknown `view` dropped. The route compares the result with the address and redirects, so the address always
 * says what the page shows. The filter form's own fields (`priceMin`, `rmin.*`, ...) are left as they are: a refused box
 * keeps its "Check the filters" state.
 */
export function sanitizeSearchParams(raw: RawSearchParams): RawSearchParams {
  const clean: Record<string, string | string[] | undefined> = { ...raw };
  const q = first(raw["q"]);
  if (q !== undefined) clean["q"] = cleanWords(q);
  if (raw["f"] !== undefined) {
    clean["f"] = [...new Set(all(raw["f"]).filter(isFacetEntry))].slice(0, MAX_FACET_VALUES);
  }
  const price = first(raw["price"]);
  if (price !== undefined) {
    if (parseSearchParams({ price }, 0).ok) clean["price"] = price;
    else delete clean["price"];
  }
  const sort = first(raw["sort"]);
  if (sort !== undefined) {
    if (SEARCH_SORTS.includes(sort as SearchSort)) clean["sort"] = sort;
    else delete clean["sort"];
  }
  const page = first(raw["page"]);
  if (page !== undefined) {
    const number = /^\d{1,15}$/.test(page) ? Number(page) : 0;
    if (number < 1) delete clean["page"];
    else clean["page"] = String(Math.min(number, MAX_SEARCH_PAGE));
  }
  const view = first(raw["view"]);
  if (view !== undefined) {
    if (isCardView(view)) clean["view"] = view;
    else delete clean["view"];
  }
  return clean;
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
 * The locale-less path of a query, ready for `localizedHref`: `q`, `f`, `price`, `sort`, `page`, `view`, defaults left out. Every
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
  const view = storedView(query.view);
  if (view !== undefined) parts.push(`view=${view}`);
  return parts.length === 0 ? base : `${base}?${parts.join("&")}`;
}

const KNOWN_PARAMS = /^(q|f|price|sort|page|view|priceMin|priceMax|rmin\..*|rmax\..*)$/;

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

/** The fields only the facet form sends (major-unit price and range boxes); never part of a shared address. */
const FORM_FIELD = /^(priceMin|priceMax|rmin\..*|rmax\..*)$/;

export type SearchAddress =
  /** A query to search; `canonical: false` means the page redirects to `searchPath(query)` first. */
  | { kind: "query"; query: SearchQuery; canonical: boolean }
  /**
   * A script-less submit of the filter form whose box the parser refuses (`priceMin=12.505`, a reversed range): the page of
   * the rest of the address, with the form's failure (`describeFormFailure(reason)`) instead of a 404 (review F3).
   */
  | { kind: "form_error"; query: SearchQuery; reason: string }
  /**
   * Not reachable from an address since review SQ-04 (`sanitizeSearchParams` cleans every shared parameter); kept so a
   * future rule the cleaning does not cover fails as a 404, never as a silently different search.
   */
  | { kind: "malformed" };

/**
 * What the results route does with an address: search it, redirect it (also to the cleaned form of a bad address, review
 * SQ-04), or explain a refused form box.
 */
export function resolveSearchAddress(raw: RawSearchParams, exponent: number): SearchAddress {
  const clean = sanitizeSearchParams(raw);
  const parsed = parseSearchParams(clean, exponent);
  if (parsed.ok) {
    return { kind: "query", query: parsed.query, canonical: isCanonicalSearch(raw, parsed.query) };
  }
  if (!Object.keys(clean).some((name) => FORM_FIELD.test(name))) return { kind: "malformed" };
  const rest = parseSearchParams(
    Object.fromEntries(Object.entries(clean).filter(([name]) => !FORM_FIELD.test(name))),
    exponent,
  );
  if (!rest.ok) return { kind: "malformed" };
  return { kind: "form_error", query: { ...rest.query, page: 1 }, reason: parsed.reason };
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

/** The same results shown as `view` (the page stays: the list is the same). */
export function setView(query: SearchQuery, view: CardView): SearchQuery {
  const stored = storedView(view);
  const next: SearchQuery = { ...query };
  if (stored === undefined) delete next.view;
  else next.view = stored;
  return next;
}

export function setPage(query: SearchQuery, page: number): SearchQuery {
  if (!Number.isInteger(page) || page < 1 || page > MAX_SEARCH_PAGE) {
    throw new RangeError(
      `A search page must be a whole number from 1 to ${String(MAX_SEARCH_PAGE)}.`,
    );
  }
  return { ...query, page };
}
