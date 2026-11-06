import type { Money, Order, OrderStatus } from "@fluxkit/api-client";
import { MAX_API_OFFSET } from "./catalog-query";
import { formatMoney } from "./money";
import { paymentSection, type PaymentSectionModel } from "./payment-model";

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

/**
 * The payment block of an order page, by the order's status (UX round 2, batch 3A item 4: a cancelled order said "the
 * payment link has expired, start a new payment"). `paymentSection` (the payment model) decides what the block offers; this
 * decides whether the order page shows it at all:
 *
 * - `awaiting_payment`: as the payment model decides (pay, continue, check the status, the last attempt's failure);
 * - `paid`, `fulfilled`: only a `paid` attempt, as the confirmation; an older failed or expired attempt is history, and an
 *   order paid another way (an admin marked it) shows no payment block;
 * - `cancelled`, `expired` (and a status the storefront does not know yet): nothing, so no "pay" action or "start a new
 *   payment" text can appear on a closed order.
 */
export function orderPaymentSection(
  order: Pick<Order, "status" | "payment">,
  onlinePayment: boolean,
): PaymentSectionModel | null {
  switch (order.status) {
    case "awaiting_payment":
      return paymentSection(order, onlinePayment);
    case "paid":
    case "fulfilled":
      return order.payment.latest?.status === "paid" ? paymentSection(order, onlinePayment) : null;
    default:
      return null;
  }
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
