import type { Database } from "../database/database.module.js";
import {
  DEFAULT_CLEANUP_LIMITS,
  drainInBatches,
  type BatchLimits,
  type CleanupResult,
} from "./batches.js";
import type { JobBudget } from "./job-budget.js";
import { withJobTransaction } from "../common/job-limits.js";
import type { JobsRepository } from "./jobs.repository.js";

/** Dispatched events are kept this long, for an operator to look at, then deleted. */
export const DISPATCHED_EVENT_RETENTION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PurgeEventsDeps {
  database: Database;
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
  budget?: JobBudget,
): Promise<CleanupResult> {
  const cutoff = new Date(now.getTime() - DISPATCHED_EVENT_RETENTION_DAYS * DAY_MS);
  const drained = await drainInBatches(
    (batchSize) =>
      withJobTransaction(deps.database, (tx) =>
        deps.repository.deleteDispatchedBefore(tx, cutoff, batchSize),
      ),
    limits,
    budget,
  );
  return { deleted: drained.total, truncated: drained.truncated };
}
