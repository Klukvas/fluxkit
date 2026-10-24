/*
 * The in-process directory cache of the store shipping routes and the per-provider concurrency gate (ADR 0029 decision 6).
 * No schema, no Redis: one cache per API instance (several instances multiply carrier calls by their count, a documented
 * limit like the rate limiter's). Generic and clock-injected so the rules are tested without a provider:
 * - an entry is fresh for `ttlMs`;
 * - stale-if-error: when the provider fails, an expired entry is served (marked `stale`) for up to `staleIfErrorMs` PAST ITS
 *   EXPIRY (ADR 0029 open question 3, read as written there; decided in plan step 6); after that it is dropped;
 * - one in-flight fetch per key (request coalescing): concurrent misses share one provider call and its outcome;
 * - bounded by entry count, least recently used evicted first.
 */

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
}

export class ProviderCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly inflight = new Map<string, Promise<CacheRead<V>>>();

  constructor(
    private readonly policy: CachePolicy,
    private readonly now: () => number,
  ) {
    if (
      !Number.isInteger(policy.maxEntries) ||
      policy.maxEntries < 1 ||
      !(policy.ttlMs > 0) ||
      !(policy.staleIfErrorMs >= 0)
    ) {
      throw new RangeError("A provider cache needs a positive TTL and entry bound");
    }
  }

  size(): number {
    return this.entries.size;
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
      this.entries.delete(key);
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
    this.entries.delete(key);
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
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.policy.ttlMs });
    while (this.entries.size > this.policy.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) {
        break;
      }
      this.entries.delete(oldest.value);
    }
  }

  private async refresh(key: string, fetch: () => Promise<V>): Promise<CacheRead<V>> {
    try {
      const value = await fetch();
      this.set(key, value);
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

/**
 * At most `maxInFlight` calls run at once; up to `maxQueued` more wait in order; anything beyond is refused at once. A
 * waiting call whose signal aborts (its timeout) leaves the queue and never runs. The slot is freed when the work settles.
 */
export class ConcurrencyGate {
  private running = 0;
  private readonly waiting: { start: () => void; signal: AbortSignal }[] = [];

  constructor(
    private readonly maxInFlight: number,
    private readonly maxQueued: number,
  ) {
    if (!Number.isInteger(maxInFlight) || maxInFlight < 1 || !Number.isInteger(maxQueued)) {
      throw new RangeError("A concurrency gate needs at least one slot");
    }
  }

  inFlight(): number {
    return this.running;
  }

  queued(): number {
    return this.waiting.length;
  }

  async run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    if (this.running < this.maxInFlight) {
      this.running += 1;
    } else {
      if (this.waiting.length >= this.maxQueued) {
        throw new GateBusyError();
      }
      // Resolved by a finishing call that hands its slot over (`running` stays the same), so no newcomer can slip in.
      await new Promise<void>((resolve, reject) => {
        const waiter = { start: resolve, signal };
        const onAbort = () => {
          const index = this.waiting.indexOf(waiter);
          if (index !== -1) {
            this.waiting.splice(index, 1);
          }
          reject(signal.reason);
        };
        waiter.start = () => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        };
        signal.addEventListener("abort", onAbort, { once: true });
        this.waiting.push(waiter);
      });
    }
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next === undefined) {
        this.running -= 1;
      } else {
        next.start();
      }
    }
  }
}
