import { Inject, Injectable } from "@nestjs/common";
import { ORDER_ACTORS, ORDER_STATUSES, type OrderReadPort } from "@fluxkit/core";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import type { DbExecutor } from "../../common/transaction.js";
import { toAdminPayments } from "../../payments/admin/admin-payment-view.js";
import {
  PaymentsRepository,
  type PaymentEventRow,
  type PaymentRow,
  type RefundRow,
} from "../../payments/attempts/payments.repository.js";
import { toAdminShipments } from "../../shipping/shipments/shipment-view.js";
import { optionValuesSchema, parseAddress, parseOrderShipping, textMap } from "../order-view.js";
import {
  OrdersRepository,
  type OrderAdjustmentRow,
  type OrderItemReservationRow,
  type OrderItemRow,
  type OrderRow,
  type OrderShippingRow,
  type OrderStatusChangeRow,
  type ShipmentRow,
  type ShipmentStatusChangeRow,
} from "../orders.repository.js";
import type { AdminOrderDetail, AdminOrderSummary } from "./admin-orders.schemas.js";

/*
 * The ONE admin view of an order (plan step 6, ADR 0018): `GET /admin/orders/{id}`, the answer of every admin action and
 * the `OrderReadPort` that plugins inject are all this builder, so a rule about what an admin (or a plugin) may see
 * exists once. It is built field by field from the rows, never by spreading one, so a column added to a table later
 * (a token hash, a fingerprint) can not reach a response by accident. Texts are the full locale maps of the snapshot.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function money(amount: number, currency: string) {
  return { amount, currency };
}

function status(value: string): AdminOrderDetail["status"] {
  if (!ORDER_STATUSES.includes(value as AdminOrderDetail["status"])) {
    throw new RangeError(`The order has an unknown status: ${value}`);
  }
  return value as AdminOrderDetail["status"];
}

function actor(value: string): AdminOrderDetail["history"][number]["actorType"] {
  if (!ORDER_ACTORS.includes(value as AdminOrderDetail["history"][number]["actorType"])) {
    throw new RangeError(`The status journal has an unknown actor: ${value}`);
  }
  return value as AdminOrderDetail["history"][number]["actorType"];
}

function instant(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/** Everything the view needs, loaded by the caller in a fixed number of statements. */
export interface AdminOrderParts {
  readonly order: OrderRow;
  readonly items: readonly OrderItemRow[];
  readonly history: readonly OrderStatusChangeRow[];
  readonly adjustments: readonly OrderAdjustmentRow[];
  readonly reservations: readonly OrderItemReservationRow[];
  /** The shipping snapshot; `undefined` for an order without one. */
  readonly shipping: OrderShippingRow | undefined;
  /** The order's shipments, oldest first, and their status journals. */
  readonly shipments: readonly ShipmentRow[];
  readonly shipmentChanges: readonly ShipmentStatusChangeRow[];
  /** The order's payment attempts, oldest first, with the refunds and journal rows of all of them. */
  readonly payments: readonly PaymentRow[];
  readonly paymentRefunds: readonly RefundRow[];
  readonly paymentEvents: readonly PaymentEventRow[];
}

export function buildAdminOrderView(parts: AdminOrderParts): AdminOrderDetail {
  const { order } = parts;
  const reservationsOf = new Map<string, { status: string; quantity: number }[]>();
  for (const entry of parts.reservations) {
    const list = reservationsOf.get(entry.orderItemId) ?? [];
    list.push({ status: entry.status, quantity: entry.quantity });
    reservationsOf.set(entry.orderItemId, list);
  }
  return {
    id: order.id,
    number: order.number,
    status: status(order.status),
    locale: order.locale,
    currency: order.currency,
    customerId: order.customerId,
    // A customer order has no token (CHECK), and keeps none when its customer is deleted: only a guest order has one.
    isGuest: order.customerId === null && order.accessTokenHash !== null,
    contact: {
      email: order.email,
      phone: order.phone,
      firstName: order.firstName,
      lastName: order.lastName,
    },
    contactErasedAt: instant(order.contactErasedAt),
    shippingAddress: parseAddress(order.shippingAddress),
    billingAddress: parseAddress(order.billingAddress),
    items: parts.items.map((row) => ({
      position: row.position,
      productId: row.productId,
      variantId: row.variantId,
      sku: row.sku,
      productTitle: textMap.parse(row.productTitle),
      variantTitle: row.variantTitle === null ? null : textMap.parse(row.variantTitle),
      optionValues: optionValuesSchema.parse(row.optionValues),
      imageUrl: row.imageUrl,
      unitPrice: money(row.unitAmount, row.currency),
      compareAtAmount: row.compareAtAmount,
      quantity: row.quantity,
      lineTotal: money(row.lineTotal, row.currency),
      requiresShipping: row.requiresShipping,
      reservations: reservationsOf.get(row.id) ?? [],
    })),
    subtotal: money(order.subtotalAmount, order.currency),
    shippingTotal: money(order.shippingTotal, order.currency),
    discountTotal: money(order.discountTotal, order.currency),
    taxTotal: money(order.taxTotal, order.currency),
    total: money(order.totalAmount, order.currency),
    adjustments: parts.adjustments.map((row) => ({
      kind: row.kind,
      code: row.code,
      label: textMap.parse(row.label),
      amount: money(row.amount, order.currency),
      includedInPrice: row.includedInPrice,
      source: row.source,
    })),
    shipping:
      parts.shipping === undefined
        ? null
        : {
            methodId: parts.shipping.methodId,
            ...parseOrderShipping(parts.shipping),
            providerService: parts.shipping.providerService,
            title: textMap.parse(parts.shipping.title),
          },
    shipments: toAdminShipments(parts.shipments, parts.shipmentChanges),
    payments: toAdminPayments(parts.payments, parts.paymentRefunds, parts.paymentEvents),
    history: parts.history.map((row) => ({
      fromStatus: row.fromStatus === null ? null : status(row.fromStatus),
      toStatus: status(row.toStatus),
      actorType: actor(row.actorType),
      actorAdminId: row.actorAdminId,
      reason: row.reason,
      at: row.createdAt.toISOString(),
    })),
    placedAt: order.placedAt.toISOString(),
    expiresAt: order.expiresAt.toISOString(),
    paidAt: instant(order.paidAt),
    fulfilledAt: instant(order.fulfilledAt),
    cancelledAt: instant(order.cancelledAt),
    expiredAt: instant(order.expiredAt),
    cancellationReason: order.cancellationReason,
    paymentReference: order.paymentReference,
  };
}

/** One list row: no addresses, no phone, no names, no journal. */
export function toAdminOrderSummary(order: OrderRow, itemCount: number): AdminOrderSummary {
  return {
    id: order.id,
    number: order.number,
    status: status(order.status),
    placedAt: order.placedAt.toISOString(),
    expiresAt: order.expiresAt.toISOString(),
    total: money(order.totalAmount, order.currency),
    currency: order.currency,
    customerId: order.customerId,
    email: order.email,
    itemCount,
  };
}

/**
 * Loads the parts of one order in a fixed number of statements (order, items, journal, adjustments, reservations, shipping,
 * shipments and their journals, payment attempts with their refunds and journals) and
 * builds the view. Implements `OrderReadPort` (token `ORDER_READ_PORT`): the admin detail route and the plugins share
 * this one method.
 */
@Injectable()
export class AdminOrderViewService implements OrderReadPort {
  constructor(
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(OrdersRepository) private readonly orders: OrdersRepository,
    @Inject(PaymentsRepository) private readonly payments: PaymentsRepository,
  ) {}

  /**
   * `undefined` when there is no such order (also for text that is not a uuid). The parts are read in ONE
   * repeatable-read, read-only transaction, so a payment that commits in between can not show a paid order with
   * reservations that are still active.
   */
  async getOrder(orderId: string): Promise<AdminOrderDetail | undefined> {
    if (typeof orderId !== "string" || !UUID.test(orderId)) {
      return undefined;
    }
    return this.database.transaction(
      async (snapshot) => {
        const order = await this.orders.findById(snapshot, orderId);
        return order === undefined ? undefined : this.build(snapshot, order);
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }

  private async build(db: DbExecutor, order: OrderRow): Promise<AdminOrderDetail> {
    // One after the other: a transaction runs on a single connection.
    const items = await this.orders.listItems(db, [order.id]);
    const history = await this.orders.listHistory(db, [order.id]);
    const adjustments = await this.orders.listAdjustments(db, [order.id]);
    const reservations = await this.orders.listItemReservations(db, [order.id]);
    const [shipping] = await this.orders.listShipping(db, [order.id]);
    const shipments = await this.orders.listShipments(db, [order.id]);
    const shipmentChanges = await this.orders.listShipmentStatusChanges(
      db,
      shipments.map((row) => row.id),
    );
    const payments = await this.payments.listAttemptsOfOrder(db, order.id);
    const paymentIds = payments.map((row) => row.id);
    const paymentRefunds = await this.payments.listRefundsOfPayments(db, paymentIds);
    const paymentEvents = await this.payments.listEventsOfPayments(db, paymentIds);
    return buildAdminOrderView({
      order,
      items,
      history,
      adjustments,
      reservations,
      shipping,
      shipments,
      shipmentChanges,
      payments,
      paymentRefunds,
      paymentEvents,
    });
  }

  async summaries(db: DbExecutor, rows: readonly OrderRow[]): Promise<AdminOrderSummary[]> {
    const counts = await this.orders.itemCounts(
      db,
      rows.map((row) => row.id),
    );
    return rows.map((row) => toAdminOrderSummary(row, counts.get(row.id) ?? 0));
  }
}
