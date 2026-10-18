import type { JobBudget } from "./job-budget.js";

/** How many rows one statement of a cleanup job touches, and how many statements one run may issue. */
export interface BatchLimits {
  batchSize: number;
  maxBatches: number;
}

export const DEFAULT_CLEANUP_LIMITS: Readonly<BatchLimits> = Object.freeze({
  batchSize: 500,
  maxBatches: 100,
});

export function assertBatchLimits(limits: BatchLimits): void {
  if (!Number.isInteger(limits.batchSize) || limits.batchSize < 1 || limits.batchSize > 10_000) {
    throw new RangeError("batchSize must be a whole number from 1 to 10000");
  }
  if (!Number.isInteger(limits.maxBatches) || limits.maxBatches < 1) {
    throw new RangeError("maxBatches must be a whole number of at least 1");
  }
}

/** What a cleanup job reports. */
export interface CleanupResult {
  deleted: number;
  /** Stopped at the batch limit with a full last batch: more rows may be left for the next run. */
  truncated: boolean;
}

export interface DrainResult {
  /** Rows the statements reported as deleted, in total. */
  total: number;
  /** The run stopped at `maxBatches` while the last batch was still full: more rows may be left for the next run. */
  truncated: boolean;
}

/**
 * Repeats `step` (one bounded statement that returns how many rows it deleted) until a batch comes back short, which
 * means nothing is left, until `maxBatches` statements ran, or until the time `budget` is used up (checked between
 * statements). A stop with rows possibly left is reported as `truncated`, never silently dropped.
 */
export async function drainInBatches(
  step: (batchSize: number) => Promise<number>,
  limits: BatchLimits,
  budget?: JobBudget,
): Promise<DrainResult> {
  assertBatchLimits(limits);
  let total = 0;
  for (let batch = 1; batch <= limits.maxBatches; batch += 1) {
    if (budget?.exhausted() === true) {
      return { total, truncated: true };
    }
    const deleted = await step(limits.batchSize);
    total += deleted;
    if (deleted < limits.batchSize) {
      return { total, truncated: false };
    }
  }
  return { total, truncated: true };
}
