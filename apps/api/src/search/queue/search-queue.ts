import { SEARCH_INDEXING, type SearchSyncReason } from "@fluxkit/core";
import { sql, type SQL } from "drizzle-orm";
import type { SearchPort } from "../../common/search-port.js";
import type { Transaction } from "../../common/transaction.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sortedIds(ids: Iterable<string>): string[] {
  const unique = new Set<string>();
  for (const id of ids) {
    if (!UUID.test(id)) {
      // A caller bug, never client input: every id comes from a row the caller just wrote or locked.
      throw new RangeError("A search sync mark needs uuids");
    }
    unique.add(id.toLowerCase());
  }
  return [...unique].sort();
}

/**
 * The coalescing upsert of `search_sync_queue` (ADR 0034 decision 5), in the caller's transaction:
 * - a new product gets a row (`change_seq` from the sequence, due now);
 * - an existing row gets a NEW `change_seq` (so a sync that claimed the old one does not delete it), the latest reason
 *   and is due now (`least` keeps an earlier due time); `enqueued_at` keeps the oldest unsynced change, `attempts` and
 *   `last_error_code` stay so a failing product remains visible.
 * Rows are taken in product id order by one statement.
 */
function upsertStatement(source: SQL, reason: SearchSyncReason): SQL {
  return sql`
    insert into search_sync_queue (product_id, reason)
    select product_id, ${reason} from (${source}) as marked (product_id)
    order by product_id
    on conflict (product_id) do update set
      reason = excluded.reason,
      change_seq = nextval('search_sync_seq'),
      next_attempt_at = least(search_sync_queue.next_attempt_at, now())`;
}

export interface SearchQueueOptions {
  /** The configured locales: a fan-out above the limit requests a rebuild of each. */
  readonly locales: readonly string[];
  /** Default core `SEARCH_INDEXING.fanOutRebuildThreshold`; tests lower it. */
  readonly fanOutRebuildThreshold?: number;
}

/** `SEARCH_PORT` with search on: the write side of the queue. Reading and claiming rows is the indexer's (step 7). */
export class SearchQueue implements SearchPort {
  readonly enabled = true;

  private readonly threshold: number;

  constructor(private readonly options: SearchQueueOptions) {
    this.threshold = options.fanOutRebuildThreshold ?? SEARCH_INDEXING.fanOutRebuildThreshold;
  }

  async productsChanged(
    tx: Transaction,
    productIds: Iterable<string>,
    reason: SearchSyncReason,
  ): Promise<void> {
    const ids = sortedIds(productIds);
    if (ids.length === 0) {
      return;
    }
    await tx.execute(upsertStatement(sql`select unnest(${sql.param(ids)}::uuid[])`, reason));
  }

  async variantsChanged(
    tx: Transaction,
    variantIds: Iterable<string>,
    reason: SearchSyncReason,
  ): Promise<void> {
    const ids = sortedIds(variantIds);
    if (ids.length === 0) {
      return;
    }
    await tx.execute(
      upsertStatement(
        sql`select distinct product_id from variant where id = any(${sql.param(ids)}::uuid[])`,
        reason,
      ),
    );
  }

  async productsChangedWhere(
    tx: Transaction,
    productIds: SQL,
    reason: SearchSyncReason,
  ): Promise<void> {
    const found = await tx.execute<{ id: string }>(
      sql`select distinct marked.id::text as id from (${productIds}) as marked (id) limit ${this.threshold + 1}`,
    );
    const ids = found.rows.map((row) => row.id);
    if (ids.length > this.threshold) {
      await this.requestRebuild(tx);
      return;
    }
    await this.productsChanged(tx, ids, reason);
  }

  /**
   * Asks for a full rebuild of every locale, in the writer's transaction (so the request becomes visible together with
   * the definition change). The stamp is strictly later than the row's previous one, even within one transaction, so job
   * 14 can answer exactly the request it read (`SearchIndexStateRepository.startBuild`/`restartBuild`); a request made
   * while a build runs starts that build over at its next run.
   */
  async requestRebuild(tx: Transaction): Promise<void> {
    await tx.execute(sql`
      insert into search_index_state (locale, rebuild_requested_at)
      select unnest(${sql.param([...this.options.locales])}::text[]), now()
      on conflict (locale) do update set
        rebuild_requested_at = greatest(now(), search_index_state.rebuild_requested_at + interval '1 microsecond'),
        updated_at = now()`);
  }
}
