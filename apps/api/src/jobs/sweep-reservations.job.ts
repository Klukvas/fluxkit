import type {
  ExpireDueCursor,
  ExpireDueResult,
  ReservationsService,
} from "../inventory/reservations/reservations.service.js";
import type { JobBudget } from "./job-budget.js";
import { DEFAULT_JOB_LIMITS, type JobLimits } from "../common/job-limits.js";

export interface SweepReservationsOptions {
  /** Reservations per `expireDue` call (default: the service default, 500). */
  limit?: number;
  /** Calls per run (default 100). A guard against a cursor that never ends. */
  maxIterations?: number;
  /** When the budget is used up the sweep starts no further call and reports `truncated` (default: none; the scheduler passes one). */
  budget?: JobBudget;
  /** Postgres `statement_timeout` and `lock_timeout` for the statements of the sweep (default: `DEFAULT_JOB_LIMITS`). */
  limits?: JobLimits;
}

export interface SweepReservationsResult {
  scanned: number;
  expired: number;
  skipped: number;
  /** Reservations that could not be expired (damaged data). Never ignored: the runner logs each as an error. */
  failures: { reservationId: string; reason: string }[];
  iterations: number;
  /** Stopped at `maxIterations` with the cursor still open, or because the time budget ran out: more may be left for the next run. */
  truncated: boolean;
}

export const DEFAULT_SWEEP_MAX_ITERATIONS = 100;

/**
 * The generic stock sweep: `ReservationsService.expireDue(now)` looped on `nextCursor` until it is null. It runs AFTER
 * the order job, so it only finds orphans (a reservation outlives its order by a grace period, ADR 0015). The cursor moves
 * past a reservation that fails, so damaged data cannot make the loop spin.
 */
export async function sweepReservations(
  deps: { reservations: Pick<ReservationsService, "expireDue"> },
  now: Date,
  options: SweepReservationsOptions = {},
): Promise<SweepReservationsResult> {
  const maxIterations = options.maxIterations ?? DEFAULT_SWEEP_MAX_ITERATIONS;
  if (!Number.isInteger(maxIterations) || maxIterations < 1) {
    throw new RangeError("maxIterations must be a whole number of at least 1");
  }
  const result: SweepReservationsResult = {
    scanned: 0,
    expired: 0,
    skipped: 0,
    failures: [],
    iterations: 0,
    truncated: false,
  };
  let after: ExpireDueCursor | undefined;
  while (result.iterations < maxIterations) {
    if (options.budget?.exhausted() === true) {
      break;
    }
    const page: ExpireDueResult = await deps.reservations.expireDue(now, {
      limit: options.limit,
      after,
      limits: options.limits ?? DEFAULT_JOB_LIMITS,
    });
    result.iterations += 1;
    result.scanned += page.scanned;
    result.expired += page.expired;
    result.skipped += page.skipped;
    result.failures.push(...page.failures);
    if (page.nextCursor === null) {
      return result;
    }
    after = page.nextCursor;
  }
  result.truncated = true;
  return result;
}
