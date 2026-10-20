/**
 * Query-string state of list screens (filters and paging live in the URL, so a list can be shared and reloaded). Pure
 * helpers: readers never throw on a bad value, they fall back to "no filter" or the default (a hand-edited URL is not an
 * error), and the API validates whatever is sent anyway.
 */

/** The API's paging bounds (`docs/api/catalog.md`, Conventions): `limit` 1 to 100, `offset` 0 to 10 000. */
export const MAX_LIMIT = 100;
export const MAX_OFFSET = 10_000;

export interface Paging {
  limit: number;
  offset: number;
}

/** A whole number written with digits only (no sign, exponent, hex or blank), or `null`. */
function wholeNumber(value: string | null): number | null {
  if (value === null || !/^\d{1,9}$/.test(value)) return null;
  return Number(value);
}

export function readPaging(
  params: URLSearchParams,
  options: { defaultLimit: number; maxLimit?: number },
): Paging {
  const maxLimit = options.maxLimit ?? MAX_LIMIT;
  const limit = wholeNumber(params.get("limit"));
  const offset = wholeNumber(params.get("offset"));
  return {
    limit: limit !== null && limit >= 1 && limit <= maxLimit ? limit : options.defaultLimit,
    offset: offset !== null && offset <= MAX_OFFSET ? offset : 0,
  };
}

/** Trimmed text of a filter; `""` (no filter) when absent or longer than `maxLength`. */
export function readText(
  params: URLSearchParams,
  key: string,
  options: { maxLength: number },
): string {
  const value = (params.get(key) ?? "").trim();
  return value.length > options.maxLength ? "" : value;
}

/** One of `allowed` (exact match), or `undefined`. */
export function readEnum<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = params.get(key);
  return value !== null && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/**
 * `?key=value&...` in the given order, or `""`. Empty, `undefined` and `null` values are left out, and so is a value equal
 * to its default, so the URL of an unfiltered first page is the bare path.
 */
export function writeQuery(
  values: Record<string, string | number | null | undefined>,
  defaults: Record<string, string | number> = {},
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") continue;
    if (defaults[key] === value) continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

/** 1-based page number of an offset. */
export function pageOfOffset(offset: number, limit: number): number {
  return Math.floor(offset / limit) + 1;
}

/** Offset of a 1-based page, kept within the API's maximum offset. */
export function offsetForPage(page: number, limit: number): number {
  return Math.min(Math.max(0, (page - 1) * limit), MAX_OFFSET);
}
