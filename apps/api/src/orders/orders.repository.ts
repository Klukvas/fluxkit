import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { DbExecutor, Transaction } from "../common/transaction.js";
import {
  domainEvent,
  orderAdjustment,
  orderItem,
  orderItemReservation,
  orderStatusChange,
  reservation,
  salesOrder,
} from "../database/schema/index.js";

export type OrderRow = typeof salesOrder.$inferSelect;
export type NewOrder = typeof salesOrder.$inferInsert;
export type OrderItemRow = typeof orderItem.$inferSelect;
export type NewOrderItem = typeof orderItem.$inferInsert;
export type OrderStatusChangeRow = typeof orderStatusChange.$inferSelect;
export type NewOrderStatusChange = typeof orderStatusChange.$inferInsert;
export type OrderAdjustmentRow = typeof orderAdjustment.$inferSelect;
export type NewDomainEvent = typeof domainEvent.$inferInsert;

/** The reservation of one order line, with the facts a batch needs to take locks in order. */
export interface OrderReservationRow {
  reservationId: string;
  variantId: string;
  locationId: string;
  status: string;
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

/**
 * Queries on the order tables (Drizzle query builder, parameterized). Knows tables and locks, not rules: the status
 * machine, totals and the snapshot are core, the lifecycle is `OrdersService` and `CheckoutService`. Every read of
 * an order by a request value (number, key) is keyed by that value alone; ownership (customer id, access token) is
 * decided by the caller's WHERE clause or hash comparison, never after loading someone else's order into a response.
 *
 * Lock order of the order module (ADR 0015): cart -> product -> variant -> level for placement; `sales_order`
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

  /** The replay of a checkout hands out a new guest token: the old hash is replaced, never kept next to the new one. */
  async rotateAccessToken(
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
      throw new Error("A rotated order was not returned.");
    }
    return row;
  }
}
