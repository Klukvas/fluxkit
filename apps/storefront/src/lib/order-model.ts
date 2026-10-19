import type { Money, Order, OrderStatus } from "@fluxkit/api-client";
import { MAX_API_OFFSET } from "./catalog-query";
import { formatMoney } from "./money";

/**
 * What the order views derive from an order of the API (plan step 7, "Errors": every status has a translated label). Pure;
 * amounts are only formatted, never added: every total is the API's.
 */

export const ORDER_STATUSES: readonly OrderStatus[] = [
  "awaiting_payment",
  "paid",
  "fulfilled",
  "cancelled",
  "expired",
];

/** `order.status.<status>`; a status the storefront does not know yet gets a neutral text instead of a broken key. */
export function orderStatusKey(status: OrderStatus): string {
  return ORDER_STATUSES.includes(status) ? `order.status.${status}` : "order.status.unknown";
}

/** The owner (customer, or guest with the token) may cancel only an unpaid order (`docs/api/orders.md`). */
export function canCancel(order: Pick<Order, "status">): boolean {
  return order.status === "awaiting_payment";
}

export interface ShopMoney {
  currency: string;
  /** `currencyExponent` of `GET /store/config`; it belongs to `currency` only. */
  exponent: number;
}

/**
 * An amount of an order. An order keeps the currency it was placed in; when the shop's currency changed since, the shop's
 * exponent does not apply and Intl's digits for that currency are used (as the cart notices do).
 */
export function orderMoney(money: Money, shop: ShopMoney, locale: string): string {
  return formatMoney(money, money.currency === shop.currency ? shop.exponent : undefined, locale);
}

/** Page size of the order history: the API's default for `GET /store/account/orders`. */
export const ACCOUNT_ORDERS_PAGE_SIZE = 24;

const PAGE_DIGITS = /^[1-9][0-9]{0,5}$/;

/** `?page` of the order history: 1 when absent, `null` when malformed or beyond the API's `offset` cap (10 000). */
export function parseOrdersPage(raw: string | null): number | null {
  if (raw === null) return 1;
  if (!PAGE_DIGITS.test(raw)) return null;
  const page = Number(raw);
  return (page - 1) * ACCOUNT_ORDERS_PAGE_SIZE > MAX_API_OFFSET ? null : page;
}
