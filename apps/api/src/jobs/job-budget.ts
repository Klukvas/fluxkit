/** How long one job may start new work in one run (ADR 0025). A job stops BETWEEN units of work, so a unit that has begun finishes. */
export const DEFAULT_JOB_BUDGET_MS = 30_000;

/**
 * A time budget for one run of one job. It reads the monotonic clock (not the wall clock, which can jump, and not the
 * injected `now` of the job, which is the instant the work is DECIDED for): its only use is to stop a job from taking
 * the whole tick. A test passes its own `clock`.
 */
export class JobBudget {
  private readonly startedAt: number;

  constructor(
    readonly ms: number,
    private readonly clock: () => number = () => performance.now(),
    private readonly signal?: AbortSignal,
  ) {
    if (!Number.isFinite(ms) || ms < 1) {
      throw new RangeError("A job budget must be a positive number of milliseconds");
    }
    this.startedAt = clock();
  }

  remainingMs(): number {
    return this.signal?.aborted === true
      ? 0
      : Math.max(0, this.ms - (this.clock() - this.startedAt));
  }

  /** Whether time is used up or the signal is aborted: the job must not start another unit of work. */
  exhausted(): boolean {
    return this.signal?.aborted === true || this.clock() - this.startedAt >= this.ms;
  }
}
