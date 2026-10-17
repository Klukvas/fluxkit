import { Inject, Injectable } from "@nestjs/common";
import { resolveText, type StoreLocale } from "@fluxkit/core";
import { z } from "zod";
import { LOCALE_CONFIG, type LocaleConfig } from "../common/locale.js";
import type { DbExecutor } from "../common/transaction.js";
import { StoreService } from "../catalog/store/store.service.js";
import {
  OrdersRepository,
  type OrderAdjustmentRow,
  type OrderItemRow,
  type OrderRow,
  type OrderStatusChangeRow,
} from "./orders.repository.js";
import type { StoreOrder, StoreOrderSummary } from "./orders.schemas.js";

/*
 * The store view of an order (docs/api/orders.md): what a shopper may see of their own order, resolved to one locale.
 * It is built field by field from the rows, so nothing else can leak into a response: no row ids, no reservation, no
 * admin actor, no token hash, no idempotency key or fingerprint. The snapshot rows hold the full translated texts, so
 * history renders in any locale; a locale the snapshot does not have falls back to the default one and then to any text
 * that exists (an old order must stay readable after the configured locales change).
 */

export const textMap = z.record(z.string(), z.string());
export const optionValuesSchema = z.array(z.object({ option: textMap, value: textMap }));
const address = z.object({
  countryCode: z.string(),
  region: z.string().optional(),
  city: z.string(),
  postalCode: z.string().optional(),
  line1: z.string(),
  line2: z.string().optional(),
  recipientFirstName: z.string().optional(),
  recipientLastName: z.string().optional(),
  recipientPhone: z.string().optional(),
});

function text(map: Readonly<Record<string, string>> | null, locale: StoreLocale): string {
  if (map === null) {
    return "";
  }
  return resolveText(map, locale.locale, locale.defaultLocale) ?? Object.values(map)[0] ?? "";
}

export function parseAddress(value: unknown): z.output<typeof address> | null {
  // Stored by the checkout after the core address rules: a stored value that does not parse is damaged data.
  return value === null || value === undefined ? null : address.parse(value);
}

function money(amount: number, currency: string) {
  return { amount, currency };
}

function toItem(row: OrderItemRow, locale: StoreLocale): StoreOrder["items"][number] {
  const options = optionValuesSchema.parse(row.optionValues);
  return {
    sku: row.sku,
    productTitle: text(textMap.parse(row.productTitle), locale),
    variantTitle: row.variantTitle === null ? null : text(textMap.parse(row.variantTitle), locale),
    optionValues: options.map((entry) => ({
      option: text(entry.option, locale),
      value: text(entry.value, locale),
    })),
    imageUrl: row.imageUrl,
    unitPrice: money(row.unitAmount, row.currency),
    compareAtAmount: row.compareAtAmount,
    quantity: row.quantity,
    lineTotal: money(row.lineTotal, row.currency),
  };
}

export function toStoreOrder(
  order: OrderRow,
  items: readonly OrderItemRow[],
  history: readonly OrderStatusChangeRow[],
  adjustments: readonly OrderAdjustmentRow[],
  locale: StoreLocale,
): StoreOrder {
  return {
    number: order.number,
    status: order.status as StoreOrder["status"],
    placedAt: order.placedAt.toISOString(),
    expiresAt: order.expiresAt.toISOString(),
    currency: order.currency,
    items: items.map((row) => toItem(row, locale)),
    subtotal: money(order.subtotalAmount, order.currency),
    shippingTotal: money(order.shippingTotal, order.currency),
    discountTotal: money(order.discountTotal, order.currency),
    taxTotal: money(order.taxTotal, order.currency),
    total: money(order.totalAmount, order.currency),
    adjustments: adjustments.map((row) => ({
      kind: row.kind,
      code: row.code,
      label: text(textMap.parse(row.label), locale),
      amount: money(row.amount, order.currency),
      includedInPrice: row.includedInPrice,
    })),
    contact: {
      email: order.email,
      phone: order.phone,
      firstName: order.firstName,
      lastName: order.lastName,
    },
    shippingAddress: parseAddress(order.shippingAddress),
    billingAddress: parseAddress(order.billingAddress),
    history: history.map((row) => ({
      status: row.toStatus as StoreOrder["status"],
      at: row.createdAt.toISOString(),
    })),
  };
}

export function toStoreOrderSummary(order: OrderRow, itemCount: number): StoreOrderSummary {
  return {
    number: order.number,
    status: order.status as StoreOrderSummary["status"],
    placedAt: order.placedAt.toISOString(),
    expiresAt: order.expiresAt.toISOString(),
    total: money(order.totalAmount, order.currency),
    itemCount,
  };
}

/** Loads what the store view needs in a fixed number of statements (items, journal, adjustments) and builds it. */
@Injectable()
export class OrderViewService {
  constructor(
    @Inject(OrdersRepository) private readonly orders: OrdersRepository,
    @Inject(StoreService) private readonly store: StoreService,
    @Inject(LOCALE_CONFIG) private readonly config: LocaleConfig,
  ) {}

  /**
   * The locale of a read: `?locale` when sent (it must be configured, else `400`), otherwise the locale the order was
   * placed in, or the default one when that locale is no longer configured.
   */
  localeFor(order: OrderRow, requested: string | undefined): StoreLocale {
    if (requested !== undefined) {
      return this.store.resolveLocale(requested);
    }
    return this.store.resolveLocale(
      this.config.locales.includes(order.locale) ? order.locale : undefined,
    );
  }

  async view(db: DbExecutor, order: OrderRow, locale: StoreLocale): Promise<StoreOrder> {
    // One after the other: a transaction runs on a single connection.
    const items = await this.orders.listItems(db, [order.id]);
    const history = await this.orders.listHistory(db, [order.id]);
    const adjustments = await this.orders.listAdjustments(db, [order.id]);
    return toStoreOrder(order, items, history, adjustments, locale);
  }

  async summaries(db: DbExecutor, rows: readonly OrderRow[]): Promise<StoreOrderSummary[]> {
    const counts = await this.orders.itemCounts(
      db,
      rows.map((row) => row.id),
    );
    return rows.map((row) => toStoreOrderSummary(row, counts.get(row.id) ?? 0));
  }
}
