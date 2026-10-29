import { nextSearchSyncAttemptAt, SEARCH_INDEXING } from "@fluxkit/core";
import { sql } from "drizzle-orm";
import type { DbExecutor } from "../../common/transaction.js";

/** A queue row the sync job holds: the product and the `change_seq` it saw when it claimed the row. */
export interface ClaimedSync {
  readonly productId: string;
  readonly changeSeq: number;
  readonly attempts: number;
}

export interface QueueSummary {
  readonly depth: number;
  readonly due: number;
  readonly leased: number;
  readonly dead: number;
  readonly oldestEnqueuedAt: Date | null;
  readonly oldestDueAt: Date | null;
  readonly errorCodes: readonly { readonly code: string; readonly count: number }[];
}

/**
 * The read and settle side of `search_sync_queue` (ADR 0034 decision 5), used by the sync job and the admin status.
 * Every statement is short and runs outside the engine calls.
 */
export class SearchQueueRepository {
  /**
   * Claims up to `limit` due rows (due now and not leased by a live run), oldest due first, with `FOR UPDATE SKIP LOCKED`
   * so two runs never claim one row, and leases them for `leaseSeconds`. A run that crashes leaves its lease to expire.
   */
  async claimDue(
    db: DbExecutor,
    now: Date,
    limit: number,
    leaseSeconds: number = SEARCH_INDEXING.syncLeaseSeconds,
  ): Promise<ClaimedSync[]> {
    const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000);
    const result = await db.execute<{
      product_id: string;
      change_seq: string;
      attempts: number;
    }>(sql`
      update search_sync_queue queued set lease_until = ${leaseUntil}
      from (
        select product_id from search_sync_queue
        where next_attempt_at <= ${now} and (lease_until is null or lease_until <= ${now})
        order by next_attempt_at, product_id
        limit ${limit}
        for update skip locked
      ) due
      where queued.product_id = due.product_id
      returning queued.product_id, queued.change_seq, queued.attempts`);
    return result.rows
      .map((row) => ({
        productId: row.product_id,
        changeSeq: Number(row.change_seq),
        attempts: row.attempts,
      }))
      .sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
  }

  /**
   * The documents of the claimed products are in the index: deletes each row whose `change_seq` is still the claimed one.
   * A row marked again since the claim keeps its new `change_seq`, loses the lease and is synced by the next run, so a
   * change that arrived during the sync is never lost. Returns how many rows were deleted.
   */
  async settleSynced(db: DbExecutor, claimed: readonly ClaimedSync[]): Promise<number> {
    if (claimed.length === 0) {
      return 0;
    }
    const ids = claimed.map((row) => row.productId);
    const seqs = claimed.map((row) => String(row.changeSeq));
    return db.transaction(async (tx) => {
      const deleted = await tx.execute(sql`
        delete from search_sync_queue queued
        using unnest(${sql.param(ids)}::uuid[], ${sql.param(seqs)}::bigint[]) as synced (product_id, change_seq)
        where queued.product_id = synced.product_id and queued.change_seq = synced.change_seq`);
      await tx.execute(sql`
        update search_sync_queue set lease_until = null
        where product_id = any(${sql.param(ids)}::uuid[])`);
      return deleted.rowCount ?? 0;
    });
  }

  /**
   * The engine refused or did not answer: every claimed row counts one more failed attempt, keeps the CODE (never an
   * engine message) and waits for its backoff (1, 2, 5, 10, 30 minutes, then hourly). The rows stay; nothing is lost.
   */
  async recordFailure(
    db: DbExecutor,
    claimed: readonly ClaimedSync[],
    code: string,
    now: Date,
  ): Promise<void> {
    if (claimed.length === 0) {
      return;
    }
    const ids = claimed.map((row) => row.productId);
    const dueAt = claimed.map((row) =>
      nextSearchSyncAttemptAt(row.attempts + 1, now).toISOString(),
    );
    await db.execute(sql`
      update search_sync_queue queued set
        attempts = queued.attempts + 1,
        last_error_code = ${code},
        lease_until = null,
        next_attempt_at = failed.due_at
      from unnest(${sql.param(ids)}::uuid[], ${sql.param(dueAt)}::timestamptz[]) as failed (product_id, due_at)
      where queued.product_id = failed.product_id`);
  }

  async summary(db: DbExecutor, now: Date): Promise<QueueSummary> {
    const totals = await db.execute<{
      depth: number;
      due: number;
      leased: number;
      dead: number;
      oldest_enqueued_at: Date | null;
      oldest_due_at: Date | null;
    }>(sql`
      select
        count(*)::int as depth,
        count(*) filter (where next_attempt_at <= ${now})::int as due,
        count(*) filter (where lease_until > ${now})::int as leased,
        count(*) filter (where attempts >= ${SEARCH_INDEXING.deadAfterAttempts})::int as dead,
        min(enqueued_at) as oldest_enqueued_at,
        min(next_attempt_at) as oldest_due_at
      from search_sync_queue`);
    const codes = await db.execute<{ code: string; count: number }>(sql`
      select last_error_code as code, count(*)::int as count from search_sync_queue
      where last_error_code is not null
      group by last_error_code order by count(*) desc, last_error_code limit 5`);
    const row = totals.rows[0];
    return {
      depth: row?.depth ?? 0,
      due: row?.due ?? 0,
      leased: row?.leased ?? 0,
      dead: row?.dead ?? 0,
      oldestEnqueuedAt: toDate(row?.oldest_enqueued_at),
      oldestDueAt: toDate(row?.oldest_due_at),
      errorCodes: codes.rows,
    };
  }
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  return value instanceof Date ? value : new Date(value);
}
