import type { AdminListProductsOptions, ProductStatus } from "@fluxkit/api-client";
import { readEnum, readPaging, readText, writeQuery } from "../../router/query";

/**
 * The product list's state in the URL (filters and paging, so a list can be shared and reloaded). Pure, tested first.
 * Readers never throw: a hand-edited bad value means "no filter" (the API validates whatever is sent anyway).
 */

/** The admin list default page size (`docs/api/catalog.md`, Lists and pagination). */
export const PRODUCT_LIST_LIMIT = 50;
export const PRODUCT_STATUSES: readonly ProductStatus[] = ["draft", "active", "archived"];

/**
 * `q` of `GET /admin/products`: the start of a slug or an exact SKU (never a title). The API accepts only these characters
 * and at most 160 of them (`400` otherwise), so the form refuses the rest before asking.
 */
export const SEARCH_MAX_LENGTH = 160;
export const SEARCH_PATTERN = /^[A-Za-z0-9._-]+$/;
/** The same pattern for the native `pattern` attribute (`v` flag: the hyphen is escaped). */
export const SEARCH_PATTERN_SOURCE = "[A-Za-z0-9._\\-]+";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ProductListQuery {
  status?: ProductStatus;
  brandId?: string;
  categoryId?: string;
  /** Trimmed search text; `""` for none. */
  q: string;
  limit: number;
  offset: number;
}

export type SearchCheck =
  { ok: true; value: string } | { ok: false; reason: "too_long" | "invalid_characters" };

/** The search text as the API will take it (trimmed), or why it would be refused. Empty means "no search". */
export function checkSearchText(text: string): SearchCheck {
  const value = text.trim();
  if (value === "") return { ok: true, value };
  if (value.length > SEARCH_MAX_LENGTH) return { ok: false, reason: "too_long" };
  if (!SEARCH_PATTERN.test(value)) return { ok: false, reason: "invalid_characters" };
  return { ok: true, value };
}

function readId(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key);
  return value !== null && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

export function readProductListQuery(params: URLSearchParams): ProductListQuery {
  const status = readEnum(params, "status", PRODUCT_STATUSES);
  const brandId = readId(params, "brandId");
  const categoryId = readId(params, "categoryId");
  const search = checkSearchText(readText(params, "q", { maxLength: SEARCH_MAX_LENGTH }));
  return {
    ...(status === undefined ? {} : { status }),
    ...(brandId === undefined ? {} : { brandId }),
    ...(categoryId === undefined ? {} : { categoryId }),
    q: search.ok ? search.value : "",
    ...readPaging(params, { defaultLimit: PRODUCT_LIST_LIMIT }),
  };
}

/** `?status=…&brandId=…&categoryId=…&q=…&limit=…&offset=…`, or `""` for the unfiltered first page. */
export function writeProductListQuery(query: ProductListQuery): string {
  return writeQuery(
    {
      status: query.status,
      brandId: query.brandId,
      categoryId: query.categoryId,
      q: query.q,
      limit: query.limit,
      offset: query.offset,
    },
    { limit: PRODUCT_LIST_LIMIT, offset: 0 },
  );
}

export type FilterChange = Partial<
  Pick<ProductListQuery, "status" | "brandId" | "categoryId" | "q">
>;

/** A changed filter starts at the first page again; the other filters stay. An `undefined` value removes a filter. */
export function withFilter(query: ProductListQuery, change: FilterChange): ProductListQuery {
  const pick = <Key extends "status" | "brandId" | "categoryId">(key: Key) => {
    const value = Object.hasOwn(change, key) ? change[key] : query[key];
    return value === undefined || value === "" ? {} : { [key]: value };
  };
  return {
    ...pick("status"),
    ...pick("brandId"),
    ...pick("categoryId"),
    q: change.q ?? query.q,
    limit: query.limit,
    offset: 0,
  };
}

/** The options of `listProducts` for this query: only the filters that are set. */
export function listRequest(query: ProductListQuery): AdminListProductsOptions {
  return {
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.brandId === undefined ? {} : { brandId: query.brandId }),
    ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
    ...(query.q === "" ? {} : { q: query.q }),
    limit: query.limit,
    offset: query.offset,
  };
}
