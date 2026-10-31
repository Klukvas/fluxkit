/**
 * A FIFO concurrency limiter for the engine client's interactive calls (ADR 0041): at most `maxInFlight` holders at once,
 * at most `maxQueue` callers waiting, each waiting at most the time it was given. A caller that cannot get a slot is
 * refused with a `LimiterRejection` instead of piling more work on a saturated engine. Per process, in memory.
 */

export type LimiterRejectionReason = "queue_full" | "wait_exceeded" | "closed";

export class LimiterRejection extends Error {
  constructor(readonly reason: LimiterRejectionReason) {
    super(`Concurrency limit: ${reason}`);
    this.name = "LimiterRejection";
  }
}

export interface ConcurrencyLimiterOptions {
  /** Slots: at least 1. */
  readonly maxInFlight: number;
  /** Callers that may wait for a slot; 0 refuses whenever every slot is taken. */
  readonly maxQueue: number;
}

/** Gives the slot back; calling it again does nothing. */
export type Release = () => void;

interface Waiter {
  readonly grant: (release: Release) => void;
  readonly refuse: (rejection: LimiterRejection) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export class ConcurrencyLimiter {
  private active = 0;
  private readonly queue: Waiter[] = [];
  private closed = false;

  constructor(readonly options: ConcurrencyLimiterOptions) {
    if (!Number.isInteger(options.maxInFlight) || options.maxInFlight < 1) {
      throw new RangeError("maxInFlight must be an integer of at least 1");
    }
    if (!Number.isInteger(options.maxQueue) || options.maxQueue < 0) {
      throw new RangeError("maxQueue must be a non-negative integer");
    }
  }

  get inFlight(): number {
    return this.active;
  }

  get waiting(): number {
    return this.queue.length;
  }

  /**
   * A slot now, or after waiting at most `maxWaitMs` behind the callers that came first. Refuses with `queue_full` when
   * the queue is full, `wait_exceeded` when no slot came in time (at once for `maxWaitMs <= 0`), `closed` after `close`.
   */
  acquire(maxWaitMs: number): Promise<Release> {
    if (this.closed) {
      return Promise.reject(new LimiterRejection("closed"));
    }
    if (this.active < this.options.maxInFlight) {
      this.active += 1;
      return Promise.resolve(this.releaser());
    }
    if (this.queue.length >= this.options.maxQueue) {
      return Promise.reject(new LimiterRejection("queue_full"));
    }
    if (maxWaitMs <= 0) {
      return Promise.reject(new LimiterRejection("wait_exceeded"));
    }
    return new Promise<Release>((resolve, reject) => {
      const waiter: Waiter = {
        grant: resolve,
        refuse: reject,
        timer: setTimeout(() => {
          const index = this.queue.indexOf(waiter);
          if (index !== -1) {
            this.queue.splice(index, 1);
            reject(new LimiterRejection("wait_exceeded"));
          }
        }, maxWaitMs),
      };
      this.queue.push(waiter);
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

  /** Refuses every waiter and every later call with `closed`; tasks already running keep their slots until they end. */
  close(): void {
    this.closed = true;
    for (const waiter of this.queue.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.refuse(new LimiterRejection("closed"));
    }
  }

  private releaser(): Release {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const next = this.queue.shift();
      if (next === undefined) {
        this.active -= 1;
        return;
      }
      // The slot passes straight to the oldest waiter: the count stays, nobody can overtake it.
      clearTimeout(next.timer);
      next.grant(this.releaser());
    };
  }
}
