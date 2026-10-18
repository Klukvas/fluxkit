import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { CLOCK, type Clock } from "../auth/clock.js";
import { summarizeError } from "../common/error-summary.js";
import { DomainEventHandlerRegistry } from "./domain-event-handlers.js";
import { JobsRunner, type JobReport } from "./jobs-runner.js";
import {
  SCHEDULER_CONFIG,
  SCHEDULER_DATABASE_URL,
  type SchedulerConfig,
} from "./scheduler-config.js";
import { withSchedulerLock } from "./scheduler-lock.js";

/**
 * The same reason this many ticks in a row is worth a warning (the first skip of a kind is normal: another instance
 * holds the lock, or a tick ran a little long). After that it repeats every `SKIPPED_TICKS_WARN_EVERY` skips, so a
 * permanently idle instance of a multi-instance deployment (always `lock_held`) says so about once every half hour, not
 * every minute.
 */
export const SKIPPED_TICKS_WARN_AFTER = 3;
export const SKIPPED_TICKS_WARN_EVERY = 30;

const SKIP_REASONS = {
  lock_held: "another process holds the scheduler lock",
  overlap: "the previous tick of this process is still running",
} as const;

export type SkipReason = keyof typeof SKIP_REASONS;

export type TickOutcome =
  /** The jobs ran (each report says whether that job succeeded). */
  | { status: "ran"; reports: JobReport[] }
  /** Another process (or an earlier tick of this one) holds the lock: nothing ran. */
  | { status: "lock_held" }
  /** The previous tick of this process is still running: nothing ran. */
  | { status: "overlap" }
  /** The lock could not be taken (database unreachable): logged, nothing ran. */
  | { status: "failed" }
  | { status: "stopped" };

/**
 * The in-process scheduler (ADR 0018): when `SCHEDULER_ENABLED`, a timer every `SCHEDULER_INTERVAL_SECONDS` runs the
 * jobs under a Postgres advisory lock, so only one API instance does the work per tick. A tick never overlaps the
 * previous tick of this process, a failing job never stops the others, nothing a tick does can crash the process, and
 * shutdown clears the timer and waits for a running tick before the database pool is closed.
 */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger("Scheduler");
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<TickOutcome> | undefined;
  private stopped = false;
  private readonly skipped: Record<SkipReason, number> = { lock_held: 0, overlap: 0 };
  private skipRun: { reason: SkipReason; length: number } | undefined;

  constructor(
    @Inject(JobsRunner) private readonly runner: JobsRunner,
    @Inject(DomainEventHandlerRegistry) private readonly handlers: DomainEventHandlerRegistry,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SCHEDULER_CONFIG) private readonly config: SchedulerConfig,
    @Inject(SCHEDULER_DATABASE_URL) private readonly databaseUrl: string,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.enabled) {
      return;
    }
    const names = this.handlers.names();
    this.logger.log(
      `Scheduler on: a tick every ${String(this.config.intervalSeconds)} s, ${String(names.length)} domain event handler(s)${names.length > 0 ? ` (${names.join(", ")})` : ""}`,
    );
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.intervalSeconds * 1000);
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    // A running tick uses the database pool, which is closed after this hook: wait for it.
    await this.running;
  }

  /**
   * One tick: skipped while this process is still in the previous one; never throws. Public so a test (or an operator
   * tool) can drive it without waiting for the timer.
   */
  tick(): Promise<TickOutcome> {
    if (this.stopped) {
      return Promise.resolve({ status: "stopped" });
    }
    if (this.running !== undefined) {
      this.noteSkip("overlap");
      return Promise.resolve({ status: "overlap" });
    }
    const current = this.runOnce().then(
      (outcome) => {
        if (outcome.status === "lock_held") {
          this.noteSkip("lock_held");
        } else {
          this.skipRun = undefined;
        }
        return outcome;
      },
      (error: unknown): TickOutcome => {
        this.skipRun = undefined;
        this.logger.error(`Scheduler tick failed: ${summarizeError(error)}`);
        return { status: "failed" };
      },
    );
    this.running = current;
    void current.finally(() => {
      this.running = undefined;
    });
    return current;
  }

  /** How many ticks of this process were skipped, by reason, since it started. */
  skippedTicks(): Readonly<Record<SkipReason, number>> {
    return { ...this.skipped };
  }

  /**
   * A skipped tick is logged at debug every time; when the same reason repeats `SKIPPED_TICKS_WARN_AFTER` times in a row
   * it is a warning, and again every `SKIPPED_TICKS_WARN_EVERY` skips after that. A tick that runs, or a different
   * reason, starts the count again. Without this a tick that never finishes would show only as jobs that never run.
   */
  private noteSkip(reason: SkipReason): void {
    this.skipped[reason] += 1;
    const length = this.skipRun?.reason === reason ? this.skipRun.length + 1 : 1;
    this.skipRun = { reason, length };
    this.logger.debug(`Scheduler tick skipped (${reason}): ${SKIP_REASONS[reason]}`);
    if (
      length === SKIPPED_TICKS_WARN_AFTER ||
      (length > SKIPPED_TICKS_WARN_AFTER &&
        (length - SKIPPED_TICKS_WARN_AFTER) % SKIPPED_TICKS_WARN_EVERY === 0)
    ) {
      this.logger.warn(
        `Scheduler: ${String(length)} ticks in a row skipped (${reason}): ${SKIP_REASONS[reason]}. ` +
          (reason === "overlap"
            ? "A tick takes longer than the interval; look at the job logs."
            : "Expected on all but one instance when several run; otherwise another process holds the lock for too long."),
      );
    }
  }

  /**
   * Takes the lock WITHOUT waiting, runs every job once with `now = clock.now()`, releases the lock. Used by the tick and
   * by `pnpm jobs:run-once`. Throws if the lock connection fails; job errors are in the reports.
   */
  async runOnce(): Promise<TickOutcome> {
    const locked = await withSchedulerLock(this.databaseUrl, () =>
      this.runner.runAll(this.clock.now()),
    );
    return locked.acquired ? { status: "ran", reports: locked.value } : { status: "lock_held" };
  }
}
