import type { DbExecutor } from "../common/transaction.js";
import {
  DEFAULT_CLEANUP_LIMITS,
  drainInBatches,
  type BatchLimits,
  type CleanupResult,
} from "./batches.js";
import type { JobsRepository } from "./jobs.repository.js";

export interface CartCleanupDeps {
  database: DbExecutor;
  repository: Pick<JobsRepository, "deleteExpiredCarts">;
}

/**
 * Deletes carts with `expires_at <= now` in bounded batches (no stock is held by a cart, so there is nothing to
 * release; the lines go by the foreign key). A cart written meanwhile is skipped by the lock and by the repeated predicate.
 */
export async function deleteExpiredCarts(
  deps: CartCleanupDeps,
  now: Date,
  limits: BatchLimits = DEFAULT_CLEANUP_LIMITS,
): Promise<CleanupResult> {
  const drained = await drainInBatches(
    (batchSize) => deps.repository.deleteExpiredCarts(deps.database, now, batchSize),
    limits,
  );
  return { deleted: drained.total, truncated: drained.truncated };
}
