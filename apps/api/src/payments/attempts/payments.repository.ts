import { Injectable } from "@nestjs/common";
import { and, asc, eq, gt, isNotNull, like, lte, or } from "drizzle-orm";
import type { DbExecutor, Transaction } from "../../common/transaction.js";
import {
  domainEvent,
  orderItem,
  orderShipping,
  payment,
  paymentEvent,
  paymentRefund,
  salesOrder,
} from "../../database/schema/index.js";

export type PaymentRow = typeof payment.$inferSelect;
export type NewPaymentRow = typeof payment.$inferInsert;
export type PaymentEventRow = typeof paymentEvent.$inferSelect;
export type NewPaymentEventRow = typeof paymentEvent.$inferInsert;
export type RefundRow = typeof paymentRefund.$inferSelect;
export type NewRefundRow = typeof paymentRefund.$inferInsert;

/**
 * The columns of `payment` anyone but `PaymentChanges` may write: never `status` (the single writer), never the
 * identity, the order, the money or the creation facts.
 */
export type PaymentColumns = Partial<
  Omit<
    NewPaymentRow,
    | "id"
    | "status"
    | "orderId"
    | "providerCode"
    | "amount"
    | "currency"
    | "idempotencyKey"
    | "createdBy"
    | "createdAt"
  >
>;

/** The columns of `payment_refund` that change after its creation, never `status` (the single writer). */
export type RefundColumns = Partial<Pick<NewRefundRow, "providerModifiedAt" | "failureCode">>;

/** A due attempt of job 11, oldest due first. */
export interface DuePayment {
  readonly id: string;
  readonly nextCheckAt: Date;
}

/** Keyset cursor of job 11: `(next_check_at, id)`. */
export interface DueCursor {
  readonly nextCheckAt: Date;
  readonly id: string;
}

/** What the basket needs of one order line (snapshot, ADR 0011). */
export interface PaymentBasketLine {
  readonly productTitle: unknown;
  readonly variantTitle: unknown;
  readonly sku: string;
  readonly quantity: number;
  readonly unitAmount: number;
  readonly lineTotal: number;
  readonly currency: string;
}

export interface PaymentBasketShipping {
  readonly title: unknown;
  readonly amount: number;
  readonly currency: string;
  readonly methodCode: string;
}

/**
 * Queries on the payment tables (ADR 0032 decision 5). Knows tables and locks, not rules. Lock order of the payments
 * module (ADR 0015 extended by ADR 0032 decision 7): `sales_order` -> `payment` (by id) -> `payment_refund` (by
 * creation) -> reservations; a refund is never locked before its payment.
 */
@Injectable()
export class PaymentsRepository {
  async insertAttempt(tx: Transaction, values: NewPaymentRow): Promise<PaymentRow> {
    const [row] = await tx.insert(payment).values(values).returning();
    if (row === undefined) {
      throw new Error("Inserting a payment attempt returned no row");
    }
    return row;
  }

  async findById(db: DbExecutor, id: string): Promise<PaymentRow | undefined> {
    const [row] = await db.select().from(payment).where(eq(payment.id, id));
    return row;
  }

  /** The attempt row locked until the transaction ends; the caller holds the order row lock first. */
  async lockById(tx: Transaction, id: string): Promise<PaymentRow | undefined> {
    const [row] = await tx.select().from(payment).where(eq(payment.id, id)).for("update");
    return row;
  }

  async findByProviderPaymentId(
    db: DbExecutor,
    providerCode: string,
    providerPaymentId: string,
  ): Promise<PaymentRow | undefined> {
    const [row] = await db
      .select()
      .from(payment)
      .where(
        and(
          eq(payment.providerCode, providerCode),
          eq(payment.providerPaymentId, providerPaymentId),
        ),
      );
    return row;
  }

  async findByIdempotencyKey(
    db: DbExecutor,
    orderId: string,
    idempotencyKey: string,
  ): Promise<PaymentRow | undefined> {
    const [row] = await db
      .select()
      .from(payment)
      .where(and(eq(payment.orderId, orderId), eq(payment.idempotencyKey, idempotencyKey)));
    return row;
  }

  /** Every attempt of the order, locked in id order (the caller holds the order row lock). */
  async lockAttemptsOfOrder(tx: Transaction, orderId: string): Promise<PaymentRow[]> {
    return tx
      .select()
      .from(payment)
      .where(eq(payment.orderId, orderId))
      .orderBy(asc(payment.id))
      .for("update");
  }

  async listAttemptsOfOrder(db: DbExecutor, orderId: string): Promise<PaymentRow[]> {
    return db
      .select()
      .from(payment)
      .where(eq(payment.orderId, orderId))
      .orderBy(asc(payment.createdAt), asc(payment.id));
  }

  /** Writes columns that are not the status (`PaymentChanges` writes the status). */
  async update(tx: Transaction, id: string, columns: PaymentColumns): Promise<PaymentRow> {
    const [row] = await tx.update(payment).set(columns).where(eq(payment.id, id)).returning();
    if (row === undefined) {
      throw new Error("Updating a payment attempt matched no row");
    }
    return row;
  }

  /** Only `PaymentChanges` calls this. */
  async updateStatus(
    tx: Transaction,
    id: string,
    status: string,
    columns: PaymentColumns,
  ): Promise<PaymentRow> {
    const [row] = await tx
      .update(payment)
      .set({ ...columns, status })
      .where(eq(payment.id, id))
      .returning();
    if (row === undefined) {
      throw new Error("Updating a payment attempt matched no row");
    }
    return row;
  }

  /**
   * Inserts a journal row. With a dedupe key the insert is `ON CONFLICT (dedupe_key) DO NOTHING`: `false` means the key
   * was already journaled (a replayed webhook, a repeated read, a claim another sender holds).
   */
  async insertEvent(db: DbExecutor, values: NewPaymentEventRow): Promise<boolean> {
    const inserted = await db
      .insert(paymentEvent)
      .values(values)
      .onConflictDoNothing({ target: paymentEvent.dedupeKey })
      .returning({ id: paymentEvent.id });
    return inserted.length === 1;
  }

  async hasEvent(db: DbExecutor, dedupeKey: string): Promise<boolean> {
    const [row] = await db
      .select({ id: paymentEvent.id })
      .from(paymentEvent)
      .where(eq(paymentEvent.dedupeKey, dedupeKey));
    return row !== undefined;
  }

  /** The journal rows of an attempt whose dedupe key starts with `prefix` (oldest first). */
  async eventsWithKeyPrefix(
    db: DbExecutor,
    paymentId: string,
    prefix: string,
  ): Promise<{ dedupeKey: string; createdAt: Date }[]> {
    const rows = await db
      .select({ dedupeKey: paymentEvent.dedupeKey, createdAt: paymentEvent.createdAt })
      .from(paymentEvent)
      .where(and(eq(paymentEvent.paymentId, paymentId), like(paymentEvent.dedupeKey, `${prefix}%`)))
      .orderBy(asc(paymentEvent.createdAt), asc(paymentEvent.id));
    return rows.flatMap((row) =>
      row.dedupeKey === null ? [] : [{ dedupeKey: row.dedupeKey, createdAt: row.createdAt }],
    );
  }

  async listEvents(db: DbExecutor, paymentId: string): Promise<PaymentEventRow[]> {
    return db
      .select()
      .from(paymentEvent)
      .where(eq(paymentEvent.paymentId, paymentId))
      .orderBy(asc(paymentEvent.createdAt), asc(paymentEvent.id));
  }

  async insertRefund(tx: Transaction, values: NewRefundRow): Promise<RefundRow> {
    const [row] = await tx.insert(paymentRefund).values(values).returning();
    if (row === undefined) {
      throw new Error("Inserting a refund returned no row");
    }
    return row;
  }

  /** Every refund of the attempt, locked in creation order (the caller holds the payment row lock). */
  async lockRefundsOfPayment(tx: Transaction, paymentId: string): Promise<RefundRow[]> {
    return tx
      .select()
      .from(paymentRefund)
      .where(eq(paymentRefund.paymentId, paymentId))
      .orderBy(asc(paymentRefund.createdAt), asc(paymentRefund.id))
      .for("update");
  }

  async listRefundsOfPayment(db: DbExecutor, paymentId: string): Promise<RefundRow[]> {
    return db
      .select()
      .from(paymentRefund)
      .where(eq(paymentRefund.paymentId, paymentId))
      .orderBy(asc(paymentRefund.createdAt), asc(paymentRefund.id));
  }

  async findRefund(db: DbExecutor, id: string): Promise<RefundRow | undefined> {
    const [row] = await db.select().from(paymentRefund).where(eq(paymentRefund.id, id));
    return row;
  }

  async findRefundByIdempotencyKey(
    db: DbExecutor,
    idempotencyKey: string,
  ): Promise<RefundRow | undefined> {
    const [row] = await db
      .select()
      .from(paymentRefund)
      .where(eq(paymentRefund.idempotencyKey, idempotencyKey));
    return row;
  }

  /** Only `PaymentChanges` calls this. */
  async updateRefundStatus(
    tx: Transaction,
    id: string,
    status: string,
    columns: RefundColumns & { updatedAt: Date },
  ): Promise<RefundRow> {
    const [row] = await tx
      .update(paymentRefund)
      .set({ ...columns, status })
      .where(eq(paymentRefund.id, id))
      .returning();
    if (row === undefined) {
      throw new Error("Updating a refund matched no row");
    }
    return row;
  }

  /** Marks a refund send as started (`updated_at`), so a claim that never got an answer can be told from one in flight. */
  async touchRefund(tx: Transaction, id: string, at: Date): Promise<void> {
    await tx.update(paymentRefund).set({ updatedAt: at }).where(eq(paymentRefund.id, id));
  }

  /** Job 11: attempts with `next_check_at <= now`, after the cursor, oldest due first (`payment_next_check_at_idx`). */
  async listDue(
    db: DbExecutor,
    now: Date,
    after: DueCursor | undefined,
    limit: number,
  ): Promise<DuePayment[]> {
    const rows = await db
      .select({ id: payment.id, nextCheckAt: payment.nextCheckAt })
      .from(payment)
      .where(
        and(
          isNotNull(payment.nextCheckAt),
          lte(payment.nextCheckAt, now),
          after === undefined
            ? undefined
            : or(
                gt(payment.nextCheckAt, after.nextCheckAt),
                and(eq(payment.nextCheckAt, after.nextCheckAt), gt(payment.id, after.id)),
              ),
        ),
      )
      .orderBy(asc(payment.nextCheckAt), asc(payment.id))
      .limit(limit);
    return rows.flatMap((row) =>
      row.nextCheckAt === null ? [] : [{ id: row.id, nextCheckAt: row.nextCheckAt }],
    );
  }

  /** The order number of an attempt's order (event payloads carry it). */
  async orderNumberOf(db: DbExecutor, orderId: string): Promise<string> {
    const [row] = await db
      .select({ number: salesOrder.number })
      .from(salesOrder)
      .where(eq(salesOrder.id, orderId));
    if (row === undefined) {
      throw new Error("A payment attempt names an order that does not exist");
    }
    return row.number;
  }

  /** The outbox row of a `payment.*` event, in the caller's transaction (ADR 0018). */
  async insertDomainEvent(
    db: DbExecutor,
    values: { type: string; aggregateId: string; payload: Record<string, unknown> },
  ): Promise<void> {
    await db.insert(domainEvent).values(values);
  }

  async basketLines(db: DbExecutor, orderId: string): Promise<PaymentBasketLine[]> {
    return db
      .select({
        productTitle: orderItem.productTitle,
        variantTitle: orderItem.variantTitle,
        sku: orderItem.sku,
        quantity: orderItem.quantity,
        unitAmount: orderItem.unitAmount,
        lineTotal: orderItem.lineTotal,
        currency: orderItem.currency,
      })
      .from(orderItem)
      .where(eq(orderItem.orderId, orderId))
      .orderBy(asc(orderItem.position));
  }

  async basketShipping(
    db: DbExecutor,
    orderId: string,
  ): Promise<PaymentBasketShipping | undefined> {
    const [row] = await db
      .select({
        title: orderShipping.title,
        amount: orderShipping.amount,
        currency: orderShipping.currency,
        methodCode: orderShipping.methodCode,
      })
      .from(orderShipping)
      .where(eq(orderShipping.orderId, orderId));
    return row;
  }
}
