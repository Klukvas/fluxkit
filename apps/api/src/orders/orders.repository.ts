import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { DbExecutor, Transaction } from "../common/transaction.js";
import {
  domainEvent,
  orderAdjustment,
  orderItem,
  orderItemReservation,
  orderShipping,
  orderStatusChange,
  reservation,
  salesOrder,
  shipment,
  shipmentStatusChange,
} from "../database/schema/index.js";

export type OrderRow = typeof salesOrder.$inferSelect;
export type NewOrder = typeof salesOrder.$inferInsert;
export type OrderItemRow = typeof orderItem.$inferSelect;
export type NewOrderItem = typeof orderItem.$inferInsert;
export type OrderStatusChangeRow = typeof orderStatusChange.$inferSelect;
export type NewOrderStatusChange = typeof orderStatusChange.$inferInsert;
export type OrderAdjustmentRow = typeof orderAdjustment.$inferSelect;
export type OrderShippingRow = typeof orderShipping.$inferSelect;
export type NewDomainEvent = typeof domainEvent.$inferInsert;
export type ShipmentRow = typeof shipment.$inferSelect;
export type ShipmentStatusChangeRow = typeof shipmentStatusChange.$inferSelect;

/** The reservation of one order line, with the facts a batch needs to take locks in order. */
export interface OrderReservationRow {
  reservationId: string;
  variantId: string;
  locationId: string;
  status: string;
}

/** The reservation of one order line as the admin view shows it: status and quantity, nothing else. */
export interface OrderItemReservationRow {
  orderItemId: string;
  status: string;
  quantity: number;
}

/**
 * The filters of the admin order list, all optional and ANDed. `number` and `email` are the two halves of `q` and are
 * ORed: both are compared for equality (never LIKE), so `%` and `_` are plain characters and nothing matches by prefix.
 */
export interface AdminOrderFilter {
  readonly status?: string;
  /** Inclusive. */
  readonly placedFrom?: Date;
  /** Exclusive. */
  readonly placedTo?: Date;
  /** Stored form of an order number (`XXXX-XXXX`). */
  readonly number?: string;
  /** Normalized (trimmed, lower case) email. */
  readonly email?: string;
  /** Exactly this customer account (`sales_order_customer_id_placed_at_idx`); guest orders never match. */
  readonly customerId?: string;
}

/** The columns a status change may write (everything else on the order never changes after placement). */
export interface OrderStatusUpdate {
  status: string;
  paidAt?: Date;
  fulfilledAt?: Date;
  cancelledAt?: Date;
  expiredAt?: Date;
  cancellationReason?: string | null;
  paymentReference?: string | null;
}

function adminOrderWhere(filter: AdminOrderFilter): SQL | undefined {
  const conditions: (SQL | undefined)[] = [];
  if (filter.status !== undefined) {
    conditions.push(eq(salesOrder.status, filter.status));
  }
  if (filter.placedFrom !== undefined) {
    conditions.push(gte(salesOrder.placedAt, filter.placedFrom));
  }
  if (filter.placedTo !== undefined) {
    conditions.push(lt(salesOrder.placedAt, filter.placedTo));
  }
  if (filter.customerId !== undefined) {
    conditions.push(eq(salesOrder.customerId, filter.customerId));
  }
  const search: SQL[] = [];
  if (filter.number !== undefined) {
    search.push(eq(salesOrder.number, filter.number));
  }
  if (filter.email !== undefined) {
    search.push(eq(salesOrder.email, filter.email));
  }
  if (search.length > 0) {
    conditions.push(or(...search));
  }
  return and(...conditions);
}

/** Prefix of the text hashed for the guest email lock, so no other advisory lock key of this database can equal it. */
const GUEST_EMAIL_LOCK_NAMESPACE = "fluxkit:open-orders:guest-email:";

/**
 * Queries on the order tables (Drizzle query builder, parameterized). Knows tables and locks, not rules: the status
 * machine, totals and the snapshot are core, the lifecycle is `OrdersService` and `CheckoutService`. Every read of
 * an order by a request value (number, key) is keyed by that value alone; ownership (customer id, access token) is
 * decided by the caller's WHERE clause or hash comparison, never after loading someone else's order into a response.
 *
 * Lock order of the order module (ADR 0015, 0024): cart -> guest email advisory lock (guests only) -> product -> variant
 * -> level for placement; `sales_order`
 * (`FOR UPDATE`) -> level rows (sorted) -> reservation rows for every later change.
 */
@Injectable()
export class OrdersRepository {
  async findByIdempotencyKey(db: DbExecutor, key: string): Promise<OrderRow | undefined> {
    const [row] = await db.select().from(salesOrder).where(eq(salesOrder.idempotencyKey, key));
    return row;
  }

  async findById(db: DbExecutor, id: string): Promise<OrderRow | undefined> {
    const [row] = await db.select().from(salesOrder).where(eq(salesOrder.id, id));
    return row;
  }

  async findByNumber(db: DbExecutor, number: string): Promise<OrderRow | undefined> {
    const [row] = await db.select().from(salesOrder).where(eq(salesOrder.number, number));
    return row;
  }

  /** The order row locked until the transaction ends: always the FIRST lock of a status change. */
  async lockById(tx: Transaction, id: string): Promise<OrderRow | undefined> {
    const [row] = await tx.select().from(salesOrder).where(eq(salesOrder.id, id)).for("update");
    return row;
  }

  async lockByNumber(tx: Transaction, number: string): Promise<OrderRow | undefined> {
    const [row] = await tx
      .select()
      .from(salesOrder)
      .where(eq(salesOrder.number, number))
      .for("update");
    return row;
  }

  /** Owner check in SQL: a number that exists but belongs to someone else is as absent as an unknown one. */
  async lockByNumberOfCustomer(
    tx: Transaction,
    number: string,
    customerId: string,
  ): Promise<OrderRow | undefined> {
    const [row] = await tx
      .select()
      .from(salesOrder)
      .where(and(eq(salesOrder.number, number), eq(salesOrder.customerId, customerId)))
      .for("update");
    return row;
  }

  async findByNumberOfCustomer(
    db: DbExecutor,
    number: string,
    customerId: string,
  ): Promise<OrderRow | undefined> {
    const [row] = await db
      .select()
      .from(salesOrder)
      .where(and(eq(salesOrder.number, number), eq(salesOrder.customerId, customerId)));
    return row;
  }

  /** Newest first; the page and the total of one customer's orders (`sales_order_customer_id_placed_at_idx`). */
  async listOfCustomer(
    db: DbExecutor,
    customerId: string,
    limit: number,
    offset: number,
  ): Promise<OrderRow[]> {
    return db
      .select()
      .from(salesOrder)
      .where(eq(salesOrder.customerId, customerId))
      .orderBy(desc(salesOrder.placedAt), desc(salesOrder.id))
      .limit(limit)
      .offset(offset);
  }

  async countOfCustomer(db: DbExecutor, customerId: string): Promise<number> {
    const [row] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(salesOrder)
      .where(eq(salesOrder.customerId, customerId));
    return row?.total ?? 0;
  }

  /**
   * How many unpaid orders the customer holds (`MAX_OPEN_ORDERS`, ADR 0024). Served by
   * `sales_order_customer_id_placed_at_idx` (its first key is `customer_id`); a customer has a handful of orders in
   * practice and at most `MAX_OPEN_ORDERS` unpaid ones, so filtering the status on those rows is cheap.
   */
  async countOpenOfCustomer(tx: Transaction, customerId: string): Promise<number> {
    const [row] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(salesOrder)
      .where(and(eq(salesOrder.customerId, customerId), eq(salesOrder.status, "awaiting_payment")));
    return row?.total ?? 0;
  }

  /**
   * How many unpaid GUEST orders (no customer) carry the normalized email. Served by `sales_order_email_idx`: the
   * column is stored lower-cased and trimmed (CHECK), so an equality on the normalized address is an index lookup.
   */
  async countOpenOfGuestEmail(tx: Transaction, email: string): Promise<number> {
    const [row] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(salesOrder)
      .where(
        and(
          eq(salesOrder.email, email),
          isNull(salesOrder.customerId),
          eq(salesOrder.status, "awaiting_payment"),
        ),
      );
    return row?.total ?? 0;
  }

  /**
   * Serializes the checkouts of one guest email until the transaction ends (`pg_advisory_xact_lock` on a 64-bit hash of
   * the normalized address with a fixed prefix, so it cannot meet the constant keys of the other advisory locks). A hash collision of two different emails only makes them wait for
   * each other. Taken after the cart row and before the catalog rows (lock order, ADR 0024); no other code takes it.
   */
  async lockGuestEmail(tx: Transaction, email: string): Promise<void> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${GUEST_EMAIL_LOCK_NAMESPACE}${email}`}, 0))`,
    );
  }

  /**
   * One page of the admin list, newest first. The order is total: `placed_at desc`, then `id desc`, so two orders with
   * the same instant never swap places between pages (`sales_order_placed_at_idx` serves the first key).
   */
  async listForAdmin(
    db: DbExecutor,
    filter: AdminOrderFilter,
    limit: number,
    offset: number,
  ): Promise<OrderRow[]> {
    return db
      .select()
      .from(salesOrder)
      .where(adminOrderWhere(filter))
      .orderBy(desc(salesOrder.placedAt), desc(salesOrder.id))
      .limit(limit)
      .offset(offset);
  }

  async countForAdmin(db: DbExecutor, filter: AdminOrderFilter): Promise<number> {
    const [row] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(salesOrder)
      .where(adminOrderWhere(filter));
    return row?.total ?? 0;
  }

  /** Units per order for a page of summaries, in one query. */
  async itemCounts(db: DbExecutor, orderIds: readonly string[]): Promise<Map<string, number>> {
    if (orderIds.length === 0) {
      return new Map();
    }
    const rows = await db
      .select({
        orderId: orderItem.orderId,
        units: sql<number>`coalesce(sum(${orderItem.quantity}), 0)::int`,
      })
      .from(orderItem)
      .where(inArray(orderItem.orderId, [...orderIds]))
      .groupBy(orderItem.orderId);
    return new Map(rows.map((row) => [row.orderId, row.units]));
  }

  async insertOrder(db: DbExecutor, values: NewOrder): Promise<OrderRow> {
    const [row] = await db.insert(salesOrder).values(values).returning();
    if (row === undefined) {
      throw new Error("An inserted order was not returned.");
    }
    return row;
  }

  async insertItems(db: DbExecutor, values: readonly NewOrderItem[]): Promise<OrderItemRow[]> {
    return db
      .insert(orderItem)
      .values([...values])
      .returning();
  }

  async insertReservationLinks(
    db: DbExecutor,
    links: readonly { orderItemId: string; reservationId: string }[],
  ): Promise<void> {
    if (links.length > 0) {
      await db.insert(orderItemReservation).values([...links]);
    }
  }

  async insertStatusChange(db: DbExecutor, values: NewOrderStatusChange): Promise<void> {
    await db.insert(orderStatusChange).values(values);
  }

  async insertEvent(db: DbExecutor, values: NewDomainEvent): Promise<void> {
    await db.insert(domainEvent).values(values);
  }

  /** Items of many orders in order and position (one statement for any number of orders). */
  async listItems(db: DbExecutor, orderIds: readonly string[]): Promise<OrderItemRow[]> {
    if (orderIds.length === 0) {
      return [];
    }
    return db
      .select()
      .from(orderItem)
      .where(inArray(orderItem.orderId, [...orderIds]))
      .orderBy(asc(orderItem.orderId), asc(orderItem.position));
  }

  async listHistory(db: DbExecutor, orderIds: readonly string[]): Promise<OrderStatusChangeRow[]> {
    if (orderIds.length === 0) {
      return [];
    }
    return db
      .select()
      .from(orderStatusChange)
      .where(inArray(orderStatusChange.orderId, [...orderIds]))
      .orderBy(
        asc(orderStatusChange.orderId),
        asc(orderStatusChange.createdAt),
        asc(orderStatusChange.id),
      );
  }

  /** The shipping snapshots of the orders (at most one each; none for an order without a shipping method). */
  async listShipping(db: DbExecutor, orderIds: readonly string[]): Promise<OrderShippingRow[]> {
    if (orderIds.length === 0) {
      return [];
    }
    return db
      .select()
      .from(orderShipping)
      .where(inArray(orderShipping.orderId, [...orderIds]));
  }

  /** The shipments of the orders, oldest first (ADR 0029 decision 10; at most one active per order). */
  async listShipments(db: DbExecutor, orderIds: readonly string[]): Promise<ShipmentRow[]> {
    if (orderIds.length === 0) {
      return [];
    }
    return db
      .select()
      .from(shipment)
      .where(inArray(shipment.orderId, [...orderIds]))
      .orderBy(asc(shipment.orderId), asc(shipment.createdAt), asc(shipment.id));
  }

  /** The status journals of the shipments, in the order the changes happened. */
  async listShipmentStatusChanges(
    db: DbExecutor,
    shipmentIds: readonly string[],
  ): Promise<ShipmentStatusChangeRow[]> {
    if (shipmentIds.length === 0) {
      return [];
    }
    return db
      .select()
      .from(shipmentStatusChange)
      .where(inArray(shipmentStatusChange.shipmentId, [...shipmentIds]))
      .orderBy(
        asc(shipmentStatusChange.shipmentId),
        asc(shipmentStatusChange.createdAt),
        asc(shipmentStatusChange.id),
      );
  }

  async listAdjustments(
    db: DbExecutor,
    orderIds: readonly string[],
  ): Promise<OrderAdjustmentRow[]> {
    if (orderIds.length === 0) {
      return [];
    }
    return db
      .select()
      .from(orderAdjustment)
      .where(inArray(orderAdjustment.orderId, [...orderIds]))
      .orderBy(
        asc(orderAdjustment.orderId),
        asc(orderAdjustment.createdAt),
        asc(orderAdjustment.id),
      );
  }

  /** Every reservation held for the lines of one order (any status), read after the order row is locked. */
  async listReservationsOfOrder(db: DbExecutor, orderId: string): Promise<OrderReservationRow[]> {
    return db
      .select({
        reservationId: reservation.id,
        variantId: reservation.variantId,
        locationId: reservation.locationId,
        status: reservation.status,
      })
      .from(orderItemReservation)
      .innerJoin(orderItem, eq(orderItem.id, orderItemReservation.orderItemId))
      .innerJoin(reservation, eq(reservation.id, orderItemReservation.reservationId))
      .where(eq(orderItem.orderId, orderId))
      .orderBy(asc(reservation.variantId), asc(reservation.locationId), asc(reservation.id));
  }

  /** Status and quantity of every reservation of the lines of many orders, in one statement. */
  async listItemReservations(
    db: DbExecutor,
    orderIds: readonly string[],
  ): Promise<OrderItemReservationRow[]> {
    if (orderIds.length === 0) {
      return [];
    }
    return db
      .select({
        orderItemId: orderItemReservation.orderItemId,
        status: reservation.status,
        quantity: reservation.quantity,
      })
      .from(orderItemReservation)
      .innerJoin(orderItem, eq(orderItem.id, orderItemReservation.orderItemId))
      .innerJoin(reservation, eq(reservation.id, orderItemReservation.reservationId))
      .where(inArray(orderItem.orderId, [...orderIds]))
      .orderBy(
        asc(orderItemReservation.orderItemId),
        asc(reservation.createdAt),
        asc(reservation.id),
      );
  }

  async updateStatus(
    tx: Transaction,
    orderId: string,
    update: OrderStatusUpdate,
  ): Promise<OrderRow> {
    const [row] = await tx
      .update(salesOrder)
      .set(update)
      .where(eq(salesOrder.id, orderId))
      .returning();
    if (row === undefined) {
      throw new Error("An updated order was not returned.");
    }
    return row;
  }

  /**
   * The replay of a checkout renews the guest access window and writes the hash of the DERIVED token (ADR 0023). The hash
   * is the one already stored unless `ORDER_TOKEN_SECRET` changed since the order was placed; the old hash is replaced,
   * never kept next to the new one.
   */
  async renewGuestAccess(
    tx: Transaction,
    orderId: string,
    hash: string,
    expiresAt: Date,
  ): Promise<OrderRow> {
    const [row] = await tx
      .update(salesOrder)
      .set({ accessTokenHash: hash, accessExpiresAt: expiresAt })
      .where(eq(salesOrder.id, orderId))
      .returning();
    if (row === undefined) {
      throw new Error("A renewed order was not returned.");
    }
    return row;
  }
}
