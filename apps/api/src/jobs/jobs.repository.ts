import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, lt, sql, type AnyColumn } from "drizzle-orm";
import type { DbExecutor, Transaction } from "../common/transaction.js";
import { domainEvent, salesOrder } from "../database/schema/index.js";

/** Where the previous page of a keyset scan ended. `createdAt`/`expiresAt` are UTC text with microseconds (see `micros`). */
export interface TimeCursor {
  time: string;
  id: string;
}

export interface DueOrder {
  id: string;
  number: string;
  cursor: TimeCursor;
}

export interface PendingEvent {
  id: string;
  type: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  attempts: number;
  cursor: TimeCursor;
}

/** A failed delivery is retried at `created_at + (2^failures - 1) * BACKOFF_UNIT_MS` (see `docs/adr/0021-...`). */
export const BACKOFF_UNIT_MS = 60_000;
/** After this many failed deliveries an event is no longer picked; an operator looks at it. */
export const MAX_DISPATCH_ATTEMPTS = 10;

/**
 * A timestamp as UTC text with microseconds, so a cursor built from it compares exactly: a JavaScript `Date` has
 * milliseconds only and could name the same row again (the same trick as `ReservationsRepository.listDue`).
 */
function micros(column: AnyColumn) {
  return sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/**
 * The queries of the scheduler jobs (Drizzle, parameterized). Knows tables and locks, not rules: the expiry itself is
 * `OrdersService.expireOne`, the cart and session lifetimes are decided when they are written. EVERY time here is a
 * parameter (`now` comes from the caller): nothing reads the database clock, so a test with a fake clock decides.
 */
@Injectable()
export class JobsRepository {
  /**
   * `awaiting_payment` orders with `expires_at <= now`, oldest first, strictly after `after`
   * (`sales_order_status_expires_at_idx`). A snapshot: `OrdersService.expireOne` re-checks under the order lock.
   */
  async listDueOrders(
    db: DbExecutor,
    now: Date,
    limit: number,
    after: TimeCursor | undefined,
  ): Promise<DueOrder[]> {
    const rows = await db
      .select({
        id: salesOrder.id,
        number: salesOrder.number,
        expiresAt: micros(salesOrder.expiresAt),
      })
      .from(salesOrder)
      .where(
        and(
          eq(salesOrder.status, "awaiting_payment"),
          sql`${salesOrder.expiresAt} <= ${now}`,
          after === undefined
            ? undefined
            : sql`(${salesOrder.expiresAt}, ${salesOrder.id}) > (${after.time}::timestamptz, ${after.id}::uuid)`,
        ),
      )
      .orderBy(asc(salesOrder.expiresAt), asc(salesOrder.id))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      cursor: { time: row.expiresAt, id: row.id },
    }));
  }

  /**
   * Deletes up to `limit` carts with `expires_at <= now` (lines go with them by the foreign key). Rows another
   * transaction holds (a write to the cart in progress) are skipped, and the predicate is repeated on the delete, so a
   * cart that was written and got a new expiry in the meantime is never deleted. Returns the number deleted.
   */
  async deleteExpiredCarts(db: DbExecutor, now: Date, limit: number): Promise<number> {
    const result = await db.execute(sql`
      delete from cart
      where id in (
        select id from cart where expires_at <= ${now} order by expires_at limit ${limit} for update skip locked
      ) and expires_at <= ${now}
      returning id
    `);
    return result.rows.length;
  }

  /** Same for customer sessions: the ABSOLUTE `expires_at <= now` only (idle expiry is decided, and deleted, when a session is used). */
  async deleteExpiredCustomerSessions(db: DbExecutor, now: Date, limit: number): Promise<number> {
    const result = await db.execute(sql`
      delete from customer_session
      where id in (
        select id from customer_session where expires_at <= ${now} order by expires_at limit ${limit} for update skip locked
      ) and expires_at <= ${now}
      returning id
    `);
    return result.rows.length;
  }

  /**
   * Locks (`FOR UPDATE SKIP LOCKED`) up to `limit` events that are due for a delivery attempt, oldest first, strictly
   * after `after`: undispatched, fewer than `MAX_DISPATCH_ATTEMPTS` failures, and `created_at + (2^attempts - 1) *
   * BACKOFF_UNIT_MS <= now`. The locks last until the caller's transaction ends, so two dispatchers never hold the same
   * row. Uses `domain_event_dispatched_at_created_at_idx`.
   */
  async lockDueEvents(
    tx: Transaction,
    now: Date,
    limit: number,
    after: TimeCursor | undefined,
  ): Promise<PendingEvent[]> {
    const rows = await tx
      .select({
        id: domainEvent.id,
        type: domainEvent.type,
        aggregateId: domainEvent.aggregateId,
        payload: domainEvent.payload,
        createdAt: domainEvent.createdAt,
        createdAtText: micros(domainEvent.createdAt),
        attempts: domainEvent.attempts,
      })
      .from(domainEvent)
      .where(
        and(
          sql`${domainEvent.dispatchedAt} is null`,
          sql`${domainEvent.attempts} < ${MAX_DISPATCH_ATTEMPTS}`,
          sql`${domainEvent.createdAt} + ((power(2, ${domainEvent.attempts}) - 1) * ${BACKOFF_UNIT_MS}) * interval '1 millisecond' <= ${now}`,
          after === undefined
            ? undefined
            : sql`(${domainEvent.createdAt}, ${domainEvent.id}) > (${after.time}::timestamptz, ${after.id}::uuid)`,
        ),
      )
      .orderBy(asc(domainEvent.createdAt), asc(domainEvent.id))
      .limit(limit)
      .for("update", { skipLocked: true });
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      aggregateId: row.aggregateId,
      payload: row.payload as Record<string, unknown>,
      createdAt: row.createdAt,
      attempts: row.attempts,
      cursor: { time: row.createdAtText, id: row.id },
    }));
  }

  async markEventDispatched(tx: Transaction, id: string, now: Date): Promise<void> {
    await tx.update(domainEvent).set({ dispatchedAt: now }).where(eq(domainEvent.id, id));
  }

  /** One more failed delivery; `code` is a class or error code, never a message (the CHECK of the column allows no more). */
  async recordEventFailure(tx: Transaction, id: string, code: string): Promise<number> {
    const [row] = await tx
      .update(domainEvent)
      .set({ attempts: sql`${domainEvent.attempts} + 1`, lastErrorCode: code })
      .where(eq(domainEvent.id, id))
      .returning({ attempts: domainEvent.attempts });
    if (row === undefined) {
      throw new Error("A failed event row disappeared while it was locked.");
    }
    return row.attempts;
  }

  /** Deletes up to `limit` events dispatched strictly before `cutoff`. Returns the number deleted. */
  async deleteDispatchedBefore(db: DbExecutor, cutoff: Date, limit: number): Promise<number> {
    const doomed = db
      .select({ id: domainEvent.id })
      .from(domainEvent)
      .where(lt(domainEvent.dispatchedAt, cutoff))
      .limit(limit);
    const deleted = await db
      .delete(domainEvent)
      .where(and(inArray(domainEvent.id, doomed), lt(domainEvent.dispatchedAt, cutoff)))
      .returning({ id: domainEvent.id });
    return deleted.length;
  }
}
