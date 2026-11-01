/**
 * A FIFO concurrency limiter for the engine client's interactive lane (ADR 0041, ADR 0042): at most `maxInFlight` slots
 * held at once, at most `maxQueue` slots waited for, each caller waiting at most the time it was given. A caller takes
 * one slot or several at once (`weight`: one search pass is admitted as a whole) and is refused with a
 * `LimiterRejection` instead of piling more work on a saturated engine. Strict FIFO: a caller never overtakes one that
 * came first, whatever their weights, so a large pass is never starved by small ones. Per process, in memory.
 */

export type LimiterRejectionReason = "queue_full" | "wait_exceeded" | "closed" | "aborted";

export class LimiterRejection extends Error {
  constructor(readonly reason: LimiterRejectionReason) {
    super(`Concurrency limit: ${reason}`);
    this.name = "LimiterRejection";
  }
}

export interface ConcurrencyLimiterOptions {
  /** Slots: at least 1. */
  readonly maxInFlight: number;
  /** Slots that may be waited for; 0 refuses whenever the slots asked for are not free. */
  readonly maxQueue: number;
}

export interface AcquireOptions {
  /** Slots taken at once: 1 (the default) to `maxInFlight`. */
  readonly weight?: number;
  /** Aborting it removes the caller from the queue (`aborted`); it has no effect once the slots are granted. */
  readonly signal?: AbortSignal | undefined;
}

/** Since the limiter was created: what `GET /admin/search/status` shows (`engine.interactiveLane`). */
export interface LimiterCounters {
  /** Acquisitions granted (at once or after waiting). */
  readonly granted: number;
  readonly refusedQueueFull: number;
  readonly refusedWaitExceeded: number;
  /** Waiters whose signal aborted (the caller gave up): not a refusal. */
  readonly abandoned: number;
  /** Most slots held at once. */
  readonly inFlightHighWater: number;
  /** Most slots waited for at once. */
  readonly waitingHighWater: number;
}

/** Gives the slots back; calling it again does nothing. */
export type Release = () => void;

interface Waiter {
  readonly weight: number;
  readonly grant: (release: Release) => void;
  readonly refuse: (rejection: LimiterRejection) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
  detach: (() => void) | undefined;
}

export class ConcurrencyLimiter {
  private active = 0;
  private queued = 0;
  private readonly queue: Waiter[] = [];
  private closed = false;
  private granted = 0;
  private refusedQueueFull = 0;
  private refusedWaitExceeded = 0;
  private abandoned = 0;
  private inFlightHighWater = 0;
  private waitingHighWater = 0;

  constructor(readonly options: ConcurrencyLimiterOptions) {
    if (!Number.isInteger(options.maxInFlight) || options.maxInFlight < 1) {
      throw new RangeError("maxInFlight must be an integer of at least 1");
    }
    if (!Number.isInteger(options.maxQueue) || options.maxQueue < 0) {
      throw new RangeError("maxQueue must be a non-negative integer");
    }
  }

  /** Slots held now. */
  get inFlight(): number {
    return this.active;
  }

  /** Slots waited for now (one per waiting caller of weight 1). */
  get waiting(): number {
    return this.queued;
  }

  counters(): LimiterCounters {
    return {
      granted: this.granted,
      refusedQueueFull: this.refusedQueueFull,
      refusedWaitExceeded: this.refusedWaitExceeded,
      abandoned: this.abandoned,
      inFlightHighWater: this.inFlightHighWater,
      waitingHighWater: this.waitingHighWater,
    };
  }

  /**
   * `weight` slots now, or after waiting at most `maxWaitMs` behind the callers that came first. Refuses with `queue_full`
   * when the slots would not fit in the queue, `wait_exceeded` when they did not come in time (at once for
   * `maxWaitMs <= 0`), `aborted` when the signal aborts first, `closed` after `close`. Throws a `RangeError` for a weight
   * it could never grant.
   */
  acquire(maxWaitMs: number, { weight = 1, signal }: AcquireOptions = {}): Promise<Release> {
    if (!Number.isInteger(weight) || weight < 1 || weight > this.options.maxInFlight) {
      throw new RangeError(
        `weight must be an integer from 1 to ${String(this.options.maxInFlight)}`,
      );
    }
    if (this.closed) {
      return Promise.reject(new LimiterRejection("closed"));
    }
    if (signal?.aborted === true) {
      this.abandoned += 1;
      return Promise.reject(new LimiterRejection("aborted"));
    }
    if (this.queue.length === 0 && this.active + weight <= this.options.maxInFlight) {
      return Promise.resolve(this.take(weight));
    }
    if (this.queued + weight > this.options.maxQueue) {
      this.refusedQueueFull += 1;
      return Promise.reject(new LimiterRejection("queue_full"));
    }
    if (maxWaitMs <= 0) {
      this.refusedWaitExceeded += 1;
      return Promise.reject(new LimiterRejection("wait_exceeded"));
    }
    return new Promise<Release>((resolve, reject) => {
      const waiter: Waiter = {
        weight,
        grant: resolve,
        refuse: reject,
        timer: undefined,
        detach: undefined,
      };
      waiter.timer = setTimeout(() => {
        if (this.remove(waiter)) {
          this.refusedWaitExceeded += 1;
          reject(new LimiterRejection("wait_exceeded"));
          this.drain();
        }
      }, maxWaitMs);
      if (signal !== undefined) {
        const onAbort = (): void => {
          if (this.remove(waiter)) {
            this.abandoned += 1;
            reject(new LimiterRejection("aborted"));
            this.drain();
          }
        };
        signal.addEventListener("abort", onAbort, { once: true });
        waiter.detach = () => signal.removeEventListener("abort", onAbort);
      }
      this.queue.push(waiter);
      this.queued += weight;
      this.waitingHighWater = Math.max(this.waitingHighWater, this.queued);
    });
  }

  /** `task` inside a slot; the slot is given back however the task ends (value, error, timeout or abort). */
  async run<T>(maxWaitMs: number, task: () => Promise<T>): Promise<T> {
    const release = await this.acquire(maxWaitMs);
    try {
      return await task();
    } finally {
      release();
    }
  }

  /** Refuses every waiter and every later call with `closed`; holders keep their slots until they release them. */
  close(): void {
    this.closed = true;
    for (const waiter of this.queue.splice(0)) {
      this.forget(waiter);
      waiter.refuse(new LimiterRejection("closed"));
    }
    this.queued = 0;
  }

  private take(weight: number): Release {
    this.active += weight;
    this.granted += 1;
    this.inFlightHighWater = Math.max(this.inFlightHighWater, this.active);
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.active -= weight;
      this.drain();
    };
  }

  /** Grants the oldest waiters while their slots fit; stops at the first that does not (nobody overtakes it). */
  private drain(): void {
    for (;;) {
      const next = this.queue[0];
      if (next === undefined || this.active + next.weight > this.options.maxInFlight) {
        return;
      }
      this.queue.shift();
      this.queued -= next.weight;
      this.forget(next);
      next.grant(this.take(next.weight));
    }
  }

  /** Takes a waiter out of the queue; false when it already left (granted, refused or removed). */
  private remove(waiter: Waiter): boolean {
    const index = this.queue.indexOf(waiter);
    if (index === -1) {
      return false;
    }
    this.queue.splice(index, 1);
    this.queued -= waiter.weight;
    this.forget(waiter);
    return true;
  }

  private forget(waiter: Waiter): void {
    clearTimeout(waiter.timer);
    waiter.detach?.();
  }
}
