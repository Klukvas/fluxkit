import type {
  AdminConfig,
  AdminOrder,
  AdminOrderHistoryEntry,
  AdminOrderItemReservation,
  LocalizedText,
  Money,
  OrderStatus,
} from "@fluxkit/api-client";
import type { StatusTone } from "@fluxkit/ui";
import { actorLabel, type ActorLabel } from "../../lib/actor-label";
import { formatMoney } from "../../lib/format";
import { safeHttpUrl } from "../../lib/safe-http-url";
import { canRun } from "../../permissions";
import { PATHS } from "../../router/paths";

/**
 * How the orders area presents what the API answered. Pure. Every figure is the server's: line totals and order totals
 * are formatted from the integer minor units the API sent, never computed or recomputed here (no float, no
 * multiplication), and the snapshot texts are the order's own (`docs/api/orders.md`, the admin order).
 */

/** The badge of an order status: the text says it, the tone is a hint only. */
export const ORDER_STATUS_TONES: Record<OrderStatus, StatusTone> = {
  awaiting_payment: "warning",
  paid: "success",
  fulfilled: "neutral",
  cancelled: "danger",
  expired: "neutral",
};

export function orderStatusLabelKey(status: OrderStatus): string {
  return `order.status.${status}`;
}

/**
 * A snapshot text (product title, variant title, option name or value) in the UI language, else in the order's language,
 * else the first non-empty text by locale code (a stable choice), else `""`. Rendered as text only.
 */
export function snapshotText(texts: LocalizedText, uiLocale: string, orderLocale: string): string {
  for (const locale of [uiLocale, orderLocale]) {
    const text = texts[locale];
    if (text !== undefined && text !== "") return text;
  }
  for (const locale of Object.keys(texts).sort()) {
    const text = texts[locale];
    if (text !== undefined && text !== "") return text;
  }
  return "";
}

export interface MoneyContext {
  /** The UI language (number format). */
  locale: string;
  config: AdminConfig;
}

/**
 * The exponent of `currency` from the admin config (`supportedCurrencies`, the shop currency). An order keeps the
 * currency it was placed in; if the config no longer lists it, the ISO exponent that `Intl` knows is used.
 */
export function exponentOf(config: AdminConfig, currency: string): number {
  const listed = config.supportedCurrencies.find((entry) => entry.code === currency);
  if (listed !== undefined) return listed.exponent;
  if (currency === config.shopCurrency) return config.currencyExponent;
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits as number;
}

export function moneyText(money: Money, context: MoneyContext): string {
  return formatMoney(money, exponentOf(context.config, money.currency), context.locale);
}

export interface LineRow {
  key: string;
  title: string;
  variantTitle: string | null;
  options: { option: string; value: string }[];
  sku: string;
  /** Only an absolute http(s) address (`safeHttpUrl`); `null` otherwise. */
  imageUrl: string | null;
  unitPrice: string;
  compareAt: string | null;
  quantity: number;
  lineTotal: string;
  requiresShipping: boolean;
  reservations: AdminOrderItemReservation[];
}

/** The lines as the screen shows them, in the API's order. */
export function orderLineRows(
  order: AdminOrder,
  context: MoneyContext & { orderLocale: string },
): LineRow[] {
  const text = (texts: LocalizedText) => snapshotText(texts, context.locale, context.orderLocale);
  return order.items.map((item) => ({
    key: String(item.position),
    title: text(item.productTitle),
    variantTitle: item.variantTitle === null ? null : text(item.variantTitle) || null,
    options: item.optionValues.map((entry) => ({
      option: text(entry.option),
      value: text(entry.value),
    })),
    sku: item.sku,
    imageUrl: safeHttpUrl(item.imageUrl),
    unitPrice: moneyText(item.unitPrice, context),
    compareAt:
      item.compareAtAmount === null
        ? null
        : moneyText({ amount: item.compareAtAmount, currency: item.unitPrice.currency }, context),
    quantity: item.quantity,
    lineTotal: moneyText(item.lineTotal, context),
    requiresShipping: item.requiresShipping,
    reservations: item.reservations,
  }));
}

export type TotalId = "subtotal" | "shipping" | "discount" | "tax" | "total";

/** The order's totals as the API gives them (the discount signed as the API signs it). */
export function orderTotalRows(
  order: AdminOrder,
  context: MoneyContext,
): { id: TotalId; text: string }[] {
  return [
    { id: "subtotal", text: moneyText(order.subtotal, context) },
    { id: "shipping", text: moneyText(order.shippingTotal, context) },
    { id: "discount", text: moneyText(order.discountTotal, context) },
    { id: "tax", text: moneyText(order.taxTotal, context) },
    { id: "total", text: moneyText(order.total, context) },
  ];
}

/** Who changed the status: the shopper, the system, or an admin labelled per owner answer 11. */
export type HistoryActor =
  ActorLabel | { kind: "customer" } | { kind: "guest" } | { kind: "removedAdmin" };

export function historyActor(
  entry: AdminOrderHistoryEntry,
  meId: string,
  emails: ReadonlyMap<string, string> | null,
): HistoryActor {
  switch (entry.actorType) {
    case "customer":
      return { kind: "customer" };
    case "guest":
      return { kind: "guest" };
    case "system":
      return { kind: "system" };
    case "admin":
      // An admin whose account was deleted since leaves the journal row without an id.
      return entry.actorAdminId === null
        ? { kind: "removedAdmin" }
        : actorLabel(entry.actorAdminId, meId, emails);
  }
}

/** Only a session that may read the users (`users.manage`, the owners) asks for their emails; nobody else requests. */
export function wantsAdminEmails(permissions: readonly string[] | null): boolean {
  return canRun(permissions, "listUsers");
}

/**
 * The customer's detail page, once the route exists (plan step 9 adds `customerDetail`); until then `null` and the screen
 * shows the email as text. Read from the path table, so registering the route turns the link on.
 */
export function customerDetailHref(customerId: string): string | null {
  const pattern = (PATHS as Readonly<Record<string, string>>).customerDetail;
  return pattern === undefined ? null : pattern.replace(":id", encodeURIComponent(customerId));
}

/** The order list filtered by the customer account (the `customerId` filter of `GET /admin/orders`). */
export function customerOrdersHref(customerId: string): string {
  return `${PATHS.orders}?customerId=${encodeURIComponent(customerId)}`;
}
