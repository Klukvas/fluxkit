import type { DbExecutor } from "../common/transaction.js";
import {
  DEFAULT_CLEANUP_LIMITS,
  drainInBatches,
  type BatchLimits,
  type CleanupResult,
} from "./batches.js";
import type { JobsRepository } from "./jobs.repository.js";

export interface SessionCleanupDeps {
  database: DbExecutor;
  repository: Pick<JobsRepository, "deleteExpiredCustomerSessions">;
}

/**
 * Deletes customer sessions past their ABSOLUTE `expires_at` in bounded batches. A session that is only idle-expired
 * stays until it is used (then `CustomerSessionService.resolve` deletes it) or its absolute end passes (at most
 * `CUSTOMER_SESSION_MAX_HOURS` after its creation): it holds a token hash and ids, nothing else, and the rule for
 * "idle" depends on a setting that can change, so it is decided in one place only (`evaluateSession`). Admin sessions
 * are not touched here (they are cleaned at startup and at login, ADR 0009).
 */
export async function deleteExpiredCustomerSessions(
  deps: SessionCleanupDeps,
  now: Date,
  limits: BatchLimits = DEFAULT_CLEANUP_LIMITS,
): Promise<CleanupResult> {
  const drained = await drainInBatches(
    (batchSize) => deps.repository.deleteExpiredCustomerSessions(deps.database, now, batchSize),
    limits,
  );
  return { deleted: drained.total, truncated: drained.truncated };
}
