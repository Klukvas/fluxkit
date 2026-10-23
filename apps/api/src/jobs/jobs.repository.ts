import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNull, lt, sql, type AnyColumn } from "drizzle-orm";
import type { DbExecutor, Transaction } from "../common/transaction.js";
import { domainEvent, mediaUpload, salesOrder } from "../database/schema/index.js";

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
  /** Attempts counted so far; after `claimEvent` this includes the attempt that just started. */
  attempts: number;
  cursor: TimeCursor;
}

/** An event whose attempt has started (`JobsRepository.claimEvent`): `attempts` includes this attempt. */
export type ClaimedEvent = Omit<PendingEvent, "cursor">;

/** An event whose n-th attempt did not finish is tried again at `created_at + (2^n - 1) * BACKOFF_UNIT_MS` (ADR 0021, 0025). */
export const BACKOFF_UNIT_MS = 60_000;
/** After this many attempts (each counted when it starts) an event is no longer picked; an operator looks at it. */
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
 *
 * The batch deletes name their rows in a MATERIALIZED CTE on purpose. `delete ... where id in (select ... limit n for
 * update skip locked)` is planned as a nested-loop semi join that runs the subquery again for every candidate row and
 * deletes MORE than `n` rows (seen in a test: 5 rows for a limit of 2); the CTE is evaluated once.
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
   * Deletes up to `limit` carts with `expires_at <= now` (lines go with them by the foreign key). The rows are locked
   * with `SKIP LOCKED` first: a cart another transaction is writing right now (which will give it a new expiry) is
   * skipped and stays. Returns the number deleted.
   */
  async deleteExpiredCarts(db: DbExecutor, now: Date, limit: number): Promise<number> {
    const result = await db.execute(sql`
      with doomed as materialized (
        select id from cart where expires_at <= ${now} order by expires_at limit ${limit} for update skip locked
      )
      delete from cart where id in (select id from doomed) returning id
    `);
    return result.rows.length;
  }

  /** Same for customer sessions: the ABSOLUTE `expires_at <= now` only (idle expiry is decided, and deleted, when a session is used). */
  async deleteExpiredCustomerSessions(db: DbExecutor, now: Date, limit: number): Promise<number> {
    const result = await db.execute(sql`
      with doomed as materialized (
        select id from customer_session where expires_at <= ${now} order by expires_at limit ${limit} for update skip locked
      )
      delete from customer_session where id in (select id from doomed) returning id
    `);
    return result.rows.length;
  }

  /**
   * One page of abandoned uploads, oldest first: never attached and created strictly before `cutoff`. The rows are
   * locked (`FOR UPDATE SKIP LOCKED`), so a save that is attaching one right now keeps it (its lock is not waited for)
   * and nobody can attach a page row until the caller's transaction ends. Uses `media_upload_created_at_unattached_idx`.
   */
  async lockAbandonedUploadIds(db: DbExecutor, cutoff: Date, limit: number): Promise<string[]> {
    const rows = await db
      .select({ id: mediaUpload.id })
      .from(mediaUpload)
      .where(and(isNull(mediaUpload.firstAttachedAt), lt(mediaUpload.createdAt, cutoff)))
      .orderBy(asc(mediaUpload.createdAt), asc(mediaUpload.id))
      .limit(limit)
      .for("update", { skipLocked: true });
    return rows.map((row) => row.id);
  }

  /**
   * Deletes the given uploads and returns their storage keys, but only the ones that are STILL never attached and older
   * than `cutoff`: the predicate is repeated here on purpose, so the statement is safe whatever the ids were chosen
   * from (ADR 0028 decision 7: an attached upload is never deleted). The caller deletes the files after it commits.
   */
  async deleteAbandonedUploadsByIds(
    db: DbExecutor,
    ids: readonly string[],
    cutoff: Date,
  ): Promise<string[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await db
      .delete(mediaUpload)
      .where(
        and(
          inArray(mediaUpload.id, [...ids]),
          isNull(mediaUpload.firstAttachedAt),
          lt(mediaUpload.createdAt, cutoff),
        ),
      )
      .returning({ storageKey: mediaUpload.storageKey });
    return rows.map((row) => row.storageKey);
  }

  /**
   * Up to `limit` events that look due for a delivery attempt, oldest first, strictly after `after`: undispatched, fewer
   * than `MAX_DISPATCH_ATTEMPTS` attempts, and `created_at + (2^attempts - 1) * BACKOFF_UNIT_MS <= now`. A snapshot, no
   * lock: the dispatcher takes the lease of each event, then `claimEvent` re-checks all of this. Uses
   * `domain_event_dispatched_at_created_at_idx`.
   */
  async listDueEvents(
    db: DbExecutor,
    now: Date,
    limit: number,
    after: TimeCursor | undefined,
  ): Promise<PendingEvent[]> {
    const rows = await db
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
      .limit(limit);
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

  /**
   * Starts an attempt: if the event is still due (the conditions of `listDueEvents`, checked again under the row lock) it
   * gets `attempts + 1` and the row is returned with the NEW count, else `undefined` (delivered, given up or not due
   * any more since it was listed, or a row lock is held by someone else right now: `SKIP LOCKED`). The caller COMMITS
   * this before any handler runs: the attempt is on record even if the process dies in the handler (ADR 0025).
   */
  async claimEvent(tx: Transaction, id: string, now: Date): Promise<ClaimedEvent | undefined> {
    const result = await tx.execute<{
      id: string;
      type: string;
      aggregate_id: string;
      payload: Record<string, unknown>;
      created_at: string;
      attempts: number;
    }>(sql`
      with candidate as (
        select id from domain_event
        where id = ${id}::uuid
          and dispatched_at is null
          and attempts < ${MAX_DISPATCH_ATTEMPTS}
          and created_at + ((power(2, attempts) - 1) * ${BACKOFF_UNIT_MS}) * interval '1 millisecond' <= ${now}
        for update skip locked
      )
      update domain_event as event
      set attempts = event.attempts + 1
      from candidate
      where event.id = candidate.id
      returning event.id, event.type, event.aggregate_id, event.payload, event.attempts,
        to_char(event.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
    `);
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    return {
      id: row.id,
      type: row.type,
      aggregateId: row.aggregate_id,
      payload: row.payload,
      // Text, not a Date: a raw statement bypasses the column parser of Drizzle.
      createdAt: new Date(row.created_at),
      attempts: row.attempts,
    };
  }

  /** Every handler succeeded (or there was none): the event is delivered. Only an undispatched row changes. */
  async markEventDispatched(tx: Transaction, id: string, now: Date): Promise<void> {
    await tx
      .update(domainEvent)
      .set({ dispatchedAt: now })
      .where(and(eq(domainEvent.id, id), sql`${domainEvent.dispatchedAt} is null`));
  }

  /**
   * A handler failed: stores the code and returns the attempts, which `claimEvent` already counted. `code` is a class or
   * error code, never a message (the CHECK of the column allows no more).
   */
  async recordEventFailure(tx: Transaction, id: string, code: string): Promise<number> {
    const [row] = await tx
      .update(domainEvent)
      .set({ lastErrorCode: code })
      .where(and(eq(domainEvent.id, id), sql`${domainEvent.dispatchedAt} is null`))
      .returning({ attempts: domainEvent.attempts });
    if (row === undefined) {
      throw new Error("A failed event row disappeared while it was being delivered.");
    }
    return row.attempts;
  }

  /** Deletes up to `limit` events dispatched strictly before `cutoff`. Returns the number deleted. */
  async deleteDispatchedBefore(db: DbExecutor, cutoff: Date, limit: number): Promise<number> {
    const result = await db.execute(sql`
      with doomed as materialized (
        select id from domain_event where dispatched_at < ${cutoff} order by dispatched_at limit ${limit}
      )
      delete from domain_event where id in (select id from doomed) returning id
    `);
    return result.rows.length;
  }
}
