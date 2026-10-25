/*
 * The in-process directory cache of the store shipping routes and the per-provider concurrency gate (ADR 0029 decision 6).
 * No schema, no Redis: one cache per API instance (several instances multiply carrier calls by their count, a documented
 * limit like the rate limiter's). Generic and clock-injected so the rules are tested without a provider:
 * - an entry is fresh for `ttlMs`;
 * - stale-if-error: when the provider fails, an expired entry is served (marked `stale`) for up to `staleIfErrorMs` PAST ITS
 *   EXPIRY (ADR 0029 open question 3, read as written there; decided in plan step 6); after that it is dropped;
 * - one in-flight fetch per key (request coalescing): concurrent misses share one provider call and its outcome;
 * - bounded by entry count and, when a `weight` is given, by total weight (e.g. points), least recently used evicted first;
 * - a `keep` rule may refuse to store a value (it is still answered): an empty point list of a random city ref must not
 *   evict a real city (review m-2).
 */

export interface CacheOptions<V> {
  /** Whether a fetched value is stored (default: every value). A value that is not kept is answered but evicts nothing. */
  readonly keep?: (value: V) => boolean;
  /** The weight of a value (default 1 each); the cache keeps the total at most `maxWeight`. */
  readonly weight?: (value: V) => number;
  readonly maxWeight?: number;
}

export interface CachePolicy {
  readonly ttlMs: number;
  readonly staleIfErrorMs: number;
  readonly maxEntries: number;
}

export interface CacheRead<V> {
  readonly value: V;
  /** Served past its TTL because the provider failed. */
  readonly stale: boolean;
}

interface Entry<V> {
  readonly value: V;
  readonly expiresAt: number;
  readonly weight: number;
}

export class ProviderCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly inflight = new Map<string, Promise<CacheRead<V>>>();
  private totalWeight = 0;

  constructor(
    private readonly policy: CachePolicy,
    private readonly now: () => number,
    private readonly options: CacheOptions<V> = {},
  ) {
    if (
      !Number.isInteger(policy.maxEntries) ||
      policy.maxEntries < 1 ||
      !(policy.ttlMs > 0) ||
      !(policy.staleIfErrorMs >= 0) ||
      (options.maxWeight !== undefined && !(options.maxWeight >= 1))
    ) {
      throw new RangeError("A provider cache needs a positive TTL and entry bound");
    }
  }

  size(): number {
    return this.entries.size;
  }

  /** The total weight of the stored entries (their count without a `weight` option). */
  weight(): number {
    return this.totalWeight;
  }

  /** The cached value without calling anything: fresh only, or also stale within the window when `allowStale`. */
  peek(key: string, options: { allowStale?: boolean } = {}): CacheRead<V> | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    const now = this.now();
    if (now < entry.expiresAt) {
      this.touch(key, entry);
      return { value: entry.value, stale: false };
    }
    if (now >= entry.expiresAt + this.policy.staleIfErrorMs) {
      this.delete(key);
      return undefined;
    }
    return options.allowStale === true ? { value: entry.value, stale: true } : undefined;
  }

  /** Every usable entry (fresh, or stale within the window) without touching it; for a scan by another key. */
  usable(): { key: string; value: V; stale: boolean }[] {
    const now = this.now();
    const found: { key: string; value: V; stale: boolean }[] = [];
    for (const [key, entry] of this.entries) {
      if (now < entry.expiresAt + this.policy.staleIfErrorMs) {
        found.push({ key, value: entry.value, stale: now >= entry.expiresAt });
      }
    }
    return found;
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (entry !== undefined) {
      this.entries.delete(key);
      this.totalWeight -= entry.weight;
    }
  }

  /** The fresh value, else the result of ONE `fetch` per key at a time; on its failure a stale value or the failure. */
  get(key: string, fetch: () => Promise<V>): Promise<CacheRead<V>> {
    const fresh = this.peek(key);
    if (fresh !== undefined) {
      return Promise.resolve(fresh);
    }
    const running = this.inflight.get(key);
    if (running !== undefined) {
      return running;
    }
    const started = this.refresh(key, fetch).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, started);
    return started;
  }

  set(key: string, value: V): void {
    this.delete(key);
    const weight = this.options.weight?.(value) ?? 1;
    this.entries.set(key, { value, expiresAt: this.now() + this.policy.ttlMs, weight });
    this.totalWeight += weight;
    const maxWeight = this.options.maxWeight ?? Number.POSITIVE_INFINITY;
    // The entry just set is the most recent one: it is never evicted for its own weight.
    while (
      this.entries.size > 1 &&
      (this.entries.size > this.policy.maxEntries || this.totalWeight > maxWeight)
    ) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) {
        break;
      }
      this.delete(oldest.value);
    }
  }

  private async refresh(key: string, fetch: () => Promise<V>): Promise<CacheRead<V>> {
    try {
      const value = await fetch();
      if (this.options.keep === undefined || this.options.keep(value)) {
        this.set(key, value);
      }
      return { value, stale: false };
    } catch (error) {
      const stale = this.peek(key, { allowStale: true });
      if (stale !== undefined) {
        return stale;
      }
      throw error;
    }
  }

  private touch(key: string, entry: Entry<V>): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }
}

/** The gate refused a call because its queue is full: the provider is treated as unavailable for this request. */
export class GateBusyError extends Error {
  constructor() {
    super("Too many provider calls are waiting");
    this.name = "GateBusyError";
  }
}

/** `priority` calls (the checkout's pickup point) may use the reserved slots and wait ahead of `ordinary` ones. */
export type GatePriority = "ordinary" | "priority";

interface Waiter {
  readonly start: () => void;
}

/**
 * At most `maxInFlight` calls run at once; `reservedSlots` of them only for `priority` calls, so a flood of ordinary
 * lookups cannot starve a checkout (review m-2). Up to `maxQueued` more of each priority wait in order; anything beyond is
 * refused at once. A waiting priority call gets the next free slot before any ordinary one. A waiting call whose signal
 * aborts (its timeout) leaves the queue and never runs. The slot is freed when the WORK settles: a caller that gives up on
 * a timeout does not free it while the provider's call is still running (review m-3).
 */
export class ConcurrencyGate {
  private running = 0;
  private readonly waiting: Record<GatePriority, Waiter[]> = { ordinary: [], priority: [] };

  constructor(
    private readonly maxInFlight: number,
    private readonly maxQueued: number,
    private readonly reservedSlots = 0,
  ) {
    if (
      !Number.isInteger(maxInFlight) ||
      maxInFlight < 1 ||
      !Number.isInteger(maxQueued) ||
      !Number.isInteger(reservedSlots) ||
      reservedSlots < 0 ||
      reservedSlots >= maxInFlight
    ) {
      throw new RangeError("A concurrency gate needs at least one ordinary slot");
    }
  }

  inFlight(): number {
    return this.running;
  }

  queued(): number {
    return this.waiting.ordinary.length + this.waiting.priority.length;
  }

  async run<T>(
    signal: AbortSignal,
    work: () => Promise<T>,
    priority: GatePriority = "ordinary",
  ): Promise<T> {
    signal.throwIfAborted();
    if (this.canStart(priority)) {
      this.running += 1;
    } else {
      const queue = this.waiting[priority];
      if (queue.length >= this.maxQueued) {
        throw new GateBusyError();
      }
      // Started by `pump` (which counts the slot for it), so no newcomer can slip in ahead of a waiting call.
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          const index = queue.indexOf(waiter);
          if (index !== -1) {
            queue.splice(index, 1);
          }
          reject(signal.reason);
        };
        const waiter: Waiter = {
          start: () => {
            signal.removeEventListener("abort", onAbort);
            resolve();
          },
        };
        signal.addEventListener("abort", onAbort, { once: true });
        queue.push(waiter);
      });
    }
    try {
      return await work();
    } finally {
      this.running -= 1;
      this.pump();
    }
  }

  private limitOf(priority: GatePriority): number {
    return priority === "priority" ? this.maxInFlight : this.maxInFlight - this.reservedSlots;
  }

  /** A newcomer starts at once only when a slot of its kind is free and no call it must not overtake is waiting. */
  private canStart(priority: GatePriority): boolean {
    if (this.waiting.priority.length > 0) {
      return false;
    }
    if (priority === "ordinary" && this.waiting.ordinary.length > 0) {
      return false;
    }
    return this.running < this.limitOf(priority);
  }

  /** Hands free slots to waiting calls: priority ones first, then ordinary ones within their limit. */
  private pump(): void {
    for (;;) {
      if (this.waiting.priority.length > 0 && this.running < this.limitOf("priority")) {
        this.running += 1;
        this.waiting.priority.shift()?.start();
      } else if (this.waiting.ordinary.length > 0 && this.running < this.limitOf("ordinary")) {
        this.running += 1;
        this.waiting.ordinary.shift()?.start();
      } else {
        return;
      }
    }
  }
}
