/**
 * A FIFO concurrency limiter for the engine client's interactive lane (ADR 0041, ADR 0042): at most `maxInFlight` slots
 * held at once, at most `maxQueue` slots waited for, each caller waiting at most the time it was given. A caller takes
 * one slot or several (`weight`) and is refused with a `LimiterRejection` instead of piling more work on a saturated
 * engine. `acquire` grants the whole weight at once; `acquireUpTo` (one search pass, ADR 0043) grants `min(weight, free)`
 * slots as soon as at least one is free, so the head of the queue never leaves a free slot idle while it waits for more.
 * Strict FIFO: only the head of the queue is ever granted, so a caller never overtakes one that came first, whatever
 * their weights. A holder may add one spare slot at a time (`takeSpare`, ADR 0044) only while nobody waits, so a spare is
 * never a slot a waiter is waiting for. Per process, in memory.
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
  /**
   * Slots that may be waited for (a waiter counts the slots it asked for); 0 never queues: `acquire` is refused whenever
   * its whole weight is not free, `acquireUpTo` whenever no slot is free.
   */
  readonly maxQueue: number;
}

export interface AcquireOptions {
  /** Slots asked for: 1 (the default) to `maxInFlight`. */
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
  /** Waiters whose signal aborted while they waited (the caller gave up): not a refusal. */
  readonly abandoned: number;
  /** Most slots held at once. */
  readonly inFlightHighWater: number;
  /** Most slots waited for at once. */
  readonly waitingHighWater: number;
}

/** Gives the slots back; calling it again does nothing. */
export type Release = () => void;

/** What `acquireUpTo` granted: `slots` from 1 to the weight asked for, given back together by `release`. */
export interface Grant {
  readonly slots: number;
  readonly release: Release;
}

interface Waiter {
  /** Slots asked for (what the queue counts). */
  readonly weight: number;
  /** Fewest slots it accepts: the weight for `acquire`, 1 for `acquireUpTo`. */
  readonly minimum: number;
  readonly grant: (grant: Grant) => void;
  readonly refuse: (rejection: LimiterRejection) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
  detach: (() => void) | undefined;
}

export class ConcurrencyLimiter {
  private active = 0;
  private queued = 0;
  private readonly queue: Waiter[] = [];
  /** Holders that could use a spare slot, offered one in turn when a slot frees while nobody waits (ADR 0044). */
  private readonly spareWatchers = new Set<() => void>();
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
    return this.enqueue(maxWaitMs, weight, weight, signal).then((grant) => grant.release);
  }

  /**
   * Up to `weight` slots (ADR 0043): as soon as the caller is at the head of the queue (at once when nobody waits) and at
   * least one slot is free, it is granted `min(weight, free)` slots; it does not wait for the rest. Refusals as `acquire`;
   * the queue counts the `weight` asked for.
   */
  acquireUpTo(maxWaitMs: number, { weight = 1, signal }: AcquireOptions = {}): Promise<Grant> {
    return this.enqueue(maxWaitMs, weight, 1, signal);
  }

  private enqueue(
    maxWaitMs: number,
    weight: number,
    minimum: number,
    signal: AbortSignal | undefined,
  ): Promise<Grant> {
    if (!Number.isInteger(weight) || weight < 1 || weight > this.options.maxInFlight) {
      throw new RangeError(
        `weight must be an integer from 1 to ${String(this.options.maxInFlight)}`,
      );
    }
    if (this.closed) {
      return Promise.reject(new LimiterRejection("closed"));
    }
    if (signal?.aborted === true) {
      // Never waited: not an abandoned waiter, and no refusal of load either (review F2 of PR 207).
      return Promise.reject(new LimiterRejection("aborted"));
    }
    if (this.queue.length === 0 && this.active + minimum <= this.options.maxInFlight) {
      return Promise.resolve(this.take(Math.min(weight, this.options.maxInFlight - this.active)));
    }
    if (this.queued + weight > this.options.maxQueue) {
      this.refusedQueueFull += 1;
      return Promise.reject(new LimiterRejection("queue_full"));
    }
    if (maxWaitMs <= 0) {
      this.refusedWaitExceeded += 1;
      return Promise.reject(new LimiterRejection("wait_exceeded"));
    }
    return new Promise<Grant>((resolve, reject) => {
      const waiter: Waiter = {
        weight,
        minimum,
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

  /**
   * One more slot for a caller that already holds some (ADR 0044): taken only when a slot is free AND nobody waits in the
   * queue, so it is never a slot a waiter is waiting for and never above `maxInFlight`. Never waits or queues and is not
   * an acquisition (`granted` does not count it); it counts in `inFlight` until its release. `undefined` when none.
   */
  takeSpare(): Release | undefined {
    if (this.closed || this.queue.length > 0 || this.active >= this.options.maxInFlight) {
      return undefined;
    }
    return this.hold(1);
  }

  /**
   * Calls `listener` whenever a slot frees while nobody waits, so it can take it with `takeSpare` at once. A listener
   * takes at most one slot per call; watchers take turns per slot (one that took a slot goes to the back, and the offer
   * goes round again while slots stay free). Returns the function that stops watching.
   */
  watchSpare(listener: () => void): () => void {
    this.spareWatchers.add(listener);
    return () => {
      this.spareWatchers.delete(listener);
    };
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

  private take(slots: number): Grant {
    this.granted += 1;
    return { slots, release: this.hold(slots) };
  }

  private hold(slots: number): Release {
    this.active += slots;
    this.inFlightHighWater = Math.max(this.inFlightHighWater, this.active);
    let released = false;
    const release = (): void => {
      if (released) {
        return;
      }
      released = true;
      this.active -= slots;
      this.drain();
    };
    return release;
  }

  /**
   * Grants the oldest waiters while their minimum fits (each gets as many of the free slots as it asked for, up to its
   * weight); stops at the first that does not fit (nobody overtakes it). With nobody left waiting, offers the free slots
   * to the spare watchers.
   */
  private drain(): void {
    for (;;) {
      const next = this.queue[0];
      if (next === undefined) {
        this.offerSpares();
        return;
      }
      if (this.active + next.minimum > this.options.maxInFlight) {
        return;
      }
      this.queue.shift();
      this.queued -= next.weight;
      this.forget(next);
      next.grant(this.take(Math.min(next.weight, this.options.maxInFlight - this.active)));
    }
  }

  /**
   * Rounds over the watchers while a slot is free and nobody waits; one that took a slot goes to the back of the turn.
   * Ends when a round takes nothing (each round that goes on took a slot, so at most `maxInFlight` rounds).
   */
  private offerSpares(): void {
    for (;;) {
      let took = false;
      for (const watcher of [...this.spareWatchers]) {
        if (this.closed || this.queue.length > 0 || this.active >= this.options.maxInFlight) {
          return;
        }
        if (!this.spareWatchers.has(watcher)) {
          continue;
        }
        const before = this.active;
        watcher();
        if (this.active > before) {
          took = true;
          if (this.spareWatchers.delete(watcher)) {
            this.spareWatchers.add(watcher);
          }
        }
      }
      if (!took) {
        return;
      }
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
