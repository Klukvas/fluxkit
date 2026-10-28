import type { AdminListOrdersOptions, OrderStatus } from "@fluxkit/api-client";
import { readEnum, readPaging, readText, writeQuery } from "../../router/query";
import { isCalendarDay, placedRange, type DayRangeFailure } from "../../lib/date-range";

/**
 * The order list's state in the URL (filters and paging, so a list can be shared and reloaded; the Stock tab's reservation
 * links open `/orders?q=<order number>`, step 9's customer screen `/orders?customerId=<id>`). Pure, tested first. Readers
 * never throw: a hand-edited bad value means "no filter"; the API validates whatever is sent anyway. The dates are
 * calendar days of the admin's time zone; `listRequest` turns them into instants (`date-range.ts`).
 */

/** The API's default page size of `GET /admin/orders` (`docs/api/orders.md`). */
export const ORDER_LIST_LIMIT = 20;
/** `q` of `GET /admin/orders`: at most 254 characters (an email's maximum). */
export const ORDER_SEARCH_MAX_LENGTH = 254;
export const ORDER_STATUS_FILTERS: readonly OrderStatus[] = [
  "awaiting_payment",
  "paid",
  "fulfilled",
  "cancelled",
  "expired",
];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OrderListQuery {
  status?: OrderStatus;
  /** First day (`YYYY-MM-DD`, included) or `""`. */
  from: string;
  /** Last day (`YYYY-MM-DD`, included) or `""`. */
  to: string;
  /** Trimmed search text (an order number or an exact email); `""` for none. */
  q: string;
  /** Only the orders of this customer account (from the customer screen); removable. */
  customerId?: string;
  limit: number;
  offset: number;
}

export type OrderSearchCheck = { ok: true; value: string } | { ok: false; reason: "too_long" };

/** The search text as the API will take it (trimmed), or why it would be refused. Empty means "no search". */
export function checkOrderSearch(text: string): OrderSearchCheck {
  const value = text.trim();
  return value.length > ORDER_SEARCH_MAX_LENGTH
    ? { ok: false, reason: "too_long" }
    : { ok: true, value };
}

/** A UUID: the Stock tab links an order by its id when a reservation has no order number. */
export function looksLikeOrderId(text: string): boolean {
  return UUID_PATTERN.test(text);
}

function readDay(params: URLSearchParams, key: string): string {
  const value = params.get(key) ?? "";
  return isCalendarDay(value) ? value : "";
}

export function readOrderListQuery(params: URLSearchParams): OrderListQuery {
  const status = readEnum(params, "status", ORDER_STATUS_FILTERS);
  const customerId = params.get("customerId");
  return {
    ...(status === undefined ? {} : { status }),
    from: readDay(params, "from"),
    to: readDay(params, "to"),
    q: readText(params, "q", { maxLength: ORDER_SEARCH_MAX_LENGTH }),
    ...(customerId !== null && UUID_PATTERN.test(customerId)
      ? { customerId: customerId.toLowerCase() }
      : {}),
    ...readPaging(params, { defaultLimit: ORDER_LIST_LIMIT }),
  };
}

/** `?status=…&from=…&to=…&q=…&customerId=…&limit=…&offset=…`, or `""` for the unfiltered first page. */
export function writeOrderListQuery(query: OrderListQuery): string {
  return writeQuery(
    {
      status: query.status,
      from: query.from,
      to: query.to,
      q: query.q,
      customerId: query.customerId,
      limit: query.limit,
      offset: query.offset,
    },
    { limit: ORDER_LIST_LIMIT, offset: 0 },
  );
}

export type OrderFilterChange = Partial<
  Pick<OrderListQuery, "status" | "from" | "to" | "q" | "customerId">
>;

/** A changed filter starts at the first page again; the other filters stay. An `undefined` value removes a filter. */
export function withFilter(query: OrderListQuery, change: OrderFilterChange): OrderListQuery {
  const pick = <Key extends "status" | "customerId">(key: Key) => {
    const value = Object.hasOwn(change, key) ? change[key] : query[key];
    return value === undefined || value === "" ? {} : { [key]: value };
  };
  return {
    ...pick("status"),
    from: change.from ?? query.from,
    to: change.to ?? query.to,
    q: change.q ?? query.q,
    ...pick("customerId"),
    limit: query.limit,
    offset: 0,
  };
}

export type OrderListRequest =
  | { ok: true; options: AdminListOrdersOptions }
  | { ok: false; field: "from" | "to"; reason: DayRangeFailure };

/** The options of `listOrders` for this query in `timeZone` (only the filters that are set), or why nothing is sent. */
export function listRequest(query: OrderListQuery, timeZone: string): OrderListRequest {
  const range = placedRange(query.from, query.to, timeZone);
  if (!range.ok) return range;
  return {
    ok: true,
    options: {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(range.placedFrom === undefined ? {} : { placedFrom: range.placedFrom }),
      ...(range.placedTo === undefined ? {} : { placedTo: range.placedTo }),
      ...(query.q === "" ? {} : { q: query.q }),
      ...(query.customerId === undefined ? {} : { customerId: query.customerId }),
      limit: query.limit,
      offset: query.offset,
    },
  };
}
