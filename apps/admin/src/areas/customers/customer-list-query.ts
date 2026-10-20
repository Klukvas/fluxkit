import type { AdminListCustomersOptions } from "@fluxkit/api-client";
import { readPaging, readText, writeQuery } from "../../router/query";

/**
 * The customer list's state in the URL: the email search and the paging, so a list can be shared and reloaded. Pure,
 * tested first. Readers never throw: a hand-edited bad value means "no filter" (the API validates whatever is sent). The
 * API offers no other filter (`docs/api/customers.md`: `q`, `limit`, `offset`), so there is no status filter here. The URL
 * holds only what the admin typed (`q`) and the paging, never a customer's data.
 */

/** The API's default page size of `GET /admin/customers` (`docs/api/customers.md`). */
export const CUSTOMER_LIST_LIMIT = 50;
/** `q` of `GET /admin/customers`: at most 254 characters (`EMAIL_MAX_LENGTH`). */
export const CUSTOMER_SEARCH_MAX_LENGTH = 254;

export interface CustomerListQuery {
  /** Trimmed start of an email (the API ignores case); `""` for no search. */
  q: string;
  limit: number;
  offset: number;
}

export type CustomerSearchCheck = { ok: true; value: string } | { ok: false; reason: "too_long" };

/**
 * The search text as the API will take it (surrounding spaces do not count there, so they are trimmed here too), or why
 * it would be refused. Empty means "no search".
 */
export function checkCustomerSearch(text: string): CustomerSearchCheck {
  const value = text.trim();
  return value.length > CUSTOMER_SEARCH_MAX_LENGTH
    ? { ok: false, reason: "too_long" }
    : { ok: true, value };
}

export function readCustomerListQuery(params: URLSearchParams): CustomerListQuery {
  return {
    q: readText(params, "q", { maxLength: CUSTOMER_SEARCH_MAX_LENGTH }),
    ...readPaging(params, { defaultLimit: CUSTOMER_LIST_LIMIT }),
  };
}

/** `?q=…&limit=…&offset=…`, or `""` for the unfiltered first page. */
export function writeCustomerListQuery(query: CustomerListQuery): string {
  return writeQuery(
    { q: query.q, limit: query.limit, offset: query.offset },
    { limit: CUSTOMER_LIST_LIMIT, offset: 0 },
  );
}

/** A changed search starts at the first page again; the page size stays. */
export function withSearch(query: CustomerListQuery, q: string): CustomerListQuery {
  return { q, limit: query.limit, offset: 0 };
}

/** The options of `listCustomers` for this query (only what is set). */
export function listRequest(query: CustomerListQuery): AdminListCustomersOptions {
  return {
    ...(query.q === "" ? {} : { q: query.q }),
    limit: query.limit,
    offset: query.offset,
  };
}
