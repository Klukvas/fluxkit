import type { DbExecutor } from "../common/transaction.js";
import {
  DEFAULT_CLEANUP_LIMITS,
  drainInBatches,
  type BatchLimits,
  type CleanupResult,
} from "./batches.js";
import type { JobsRepository } from "./jobs.repository.js";

/** Dispatched events are kept this long, for an operator to look at, then deleted. */
export const DISPATCHED_EVENT_RETENTION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PurgeEventsDeps {
  database: DbExecutor;
  repository: Pick<JobsRepository, "deleteDispatchedBefore">;
}

/**
 * Deletes events dispatched strictly more than `DISPATCHED_EVENT_RETENTION_DAYS` days before `now` (an event
 * dispatched exactly 7 days ago is kept). Undispatched events are never deleted, whatever their age.
 */
export async function deleteDispatchedEvents(
  deps: PurgeEventsDeps,
  now: Date,
  limits: BatchLimits = DEFAULT_CLEANUP_LIMITS,
): Promise<CleanupResult> {
  const cutoff = new Date(now.getTime() - DISPATCHED_EVENT_RETENTION_DAYS * DAY_MS);
  const drained = await drainInBatches(
    (batchSize) => deps.repository.deleteDispatchedBefore(deps.database, cutoff, batchSize),
    limits,
  );
  return { deleted: drained.total, truncated: drained.truncated };
}
