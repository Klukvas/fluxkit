import { summarizeError } from "../common/error-summary.js";
import { DEFAULT_JOB_LIMITS, type JobLimits } from "../common/job-limits.js";
import type { DueCursor } from "../payments/attempts/payments.repository.js";
import type {
  PaymentReconcileService,
  ReconcileAction,
} from "../payments/payment-reconcile.service.js";
import { assertBatchLimits, type BatchLimits } from "./batches.js";
import type { JobBudget } from "./job-budget.js";

/** Pages of 50 due attempts, at most 10 pages per run (ADR 0032 decision 13, ADR 0025 bounds). */
export const RECONCILE_LIMITS: Readonly<BatchLimits> = Object.freeze({
  batchSize: 50,
  maxBatches: 10,
});

export interface ReconcilePaymentsResult {
  /** Due attempts looked at. */
  scanned: number;
  polled: number;
  pollFailures: number;
  closedCrashedCreates: number;
  closedCreateUnknown: number;
  invalidated: number;
  invalidationFailures: number;
  refundsSent: number;
  rescheduled: number;
  /** Attempts left due because their provider throttled us in this run (the rest of its work waits for the next run). */
  rateLimited: number;
  /** Attempts that could not be written (a lock timeout, damaged data): left due for the next run. */
  failures: { paymentId: string; error: string }[];
  truncated: boolean;
}

export interface ReconcilePaymentsDeps {
  reconcile: Pick<
    PaymentReconcileService,
    "enabled" | "listDue" | "reconcileOne" | "backOffAfterFailure"
  >;
}

export interface ReconcilePaymentsOptions {
  limits?: BatchLimits;
  budget?: JobBudget;
  jobLimits?: JobLimits;
}

const COUNTERS: Readonly<Record<ReconcileAction, keyof ReconcilePaymentsResult>> = {
  closed_crashed_create: "closedCrashedCreates",
  closed_create_unknown: "closedCreateUnknown",
  polled: "polled",
  poll_failed: "pollFailures",
  invalidated: "invalidated",
  invalidation_failed: "invalidationFailures",
  refunds_sent: "refundsSent",
  rescheduled: "rescheduled",
  rate_limited: "rateLimited",
};

/**
 * Job 11 `reconcile-payments` (ADR 0032 decision 13). Pages of due attempts (`next_check_at <= now`), oldest due first,
 * continued by a `(next_check_at, id)` cursor, so an attempt that fails is tried once per run and never holds the head
 * of the queue (its schedule moves on by the backoff when its read fails, when its work throws and when its provider is
 * no longer enabled). Per attempt the work of
 * `PaymentReconcileService.reconcileOne`: status reads applied as `poll` facts, closing crashed or unknown creates,
 * invalidating invoices we closed, sending and settling refunds. Provider calls run outside transactions with the API's
 * time limit; a provider that answers `rate_limited` gets no further call in this run. One failing attempt never stops
 * the others; the time budget is checked before each attempt. Runs last in the tick (after jobs 8 to 10).
 */
export async function reconcilePayments(
  deps: ReconcilePaymentsDeps,
  now: Date,
  options: ReconcilePaymentsOptions = {},
): Promise<ReconcilePaymentsResult> {
  const limits = options.limits ?? RECONCILE_LIMITS;
  assertBatchLimits(limits);
  const jobLimits = options.jobLimits ?? DEFAULT_JOB_LIMITS;
  const result: ReconcilePaymentsResult = {
    scanned: 0,
    polled: 0,
    pollFailures: 0,
    closedCrashedCreates: 0,
    closedCreateUnknown: 0,
    invalidated: 0,
    invalidationFailures: 0,
    refundsSent: 0,
    rescheduled: 0,
    rateLimited: 0,
    failures: [],
    truncated: false,
  };
  if (!deps.reconcile.enabled()) {
    return result;
  }
  const paused = new Set<string>();
  let cursor: DueCursor | undefined;
  for (let page = 1; page <= limits.maxBatches; page += 1) {
    const due = await deps.reconcile.listDue(now, cursor, limits.batchSize);
    for (const attempt of due) {
      if (options.budget?.exhausted() === true) {
        result.truncated = true;
        return result;
      }
      result.scanned += 1;
      try {
        const done = await deps.reconcile.reconcileOne(attempt.id, now, paused, jobLimits);
        for (const action of done.actions) {
          const key = COUNTERS[action];
          (result[key] as number) += 1;
        }
      } catch (error) {
        let summary = summarizeError(error);
        try {
          await deps.reconcile.backOffAfterFailure(attempt.id, now, jobLimits);
        } catch (backOffError) {
          summary = `${summary}; not backed off: ${summarizeError(backOffError)}`;
        }
        result.failures.push({ paymentId: attempt.id, error: summary });
      }
    }
    const last = due.at(-1);
    if (due.length < limits.batchSize || last === undefined) {
      return result;
    }
    cursor = { nextCheckAt: last.nextCheckAt, id: last.id };
  }
  result.truncated = true;
  return result;
}
