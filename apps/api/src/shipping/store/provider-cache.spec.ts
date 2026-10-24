import { describe, expect, it } from "vitest";
import { ConcurrencyGate, GateBusyError, ProviderCache } from "./provider-cache.js";

const HOUR = 60 * 60 * 1000;

function clock(start = 0) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const policy = { ttlMs: 24 * HOUR, staleIfErrorMs: 72 * HOUR, maxEntries: 3 };

describe("ProviderCache (ADR 0029 decision 6)", () => {
  it("serves a fresh entry without calling the provider again", async () => {
    const time = clock();
    const cache = new ProviderCache<string>(policy, time.now);
    let calls = 0;
    const fetch = () => {
      calls += 1;
      return Promise.resolve(`v${String(calls)}`);
    };
    expect(await cache.get("k", fetch)).toEqual({ value: "v1", stale: false });
    time.advance(24 * HOUR - 1);
    expect(await cache.get("k", fetch)).toEqual({ value: "v1", stale: false });
    expect(calls).toBe(1);
  });

  it("fetches again once the TTL has passed", async () => {
    const time = clock();
    const cache = new ProviderCache<string>(policy, time.now);
    let calls = 0;
    const fetch = () => {
      calls += 1;
      return Promise.resolve(`v${String(calls)}`);
    };
    await cache.get("k", fetch);
    time.advance(24 * HOUR);
    expect(await cache.get("k", fetch)).toEqual({ value: "v2", stale: false });
    expect(calls).toBe(2);
  });

  it("coalesces concurrent misses of one key into ONE provider call", async () => {
    const cache = new ProviderCache<string>(policy, clock().now);
    const pending = deferred<string>();
    let calls = 0;
    const fetch = () => {
      calls += 1;
      return pending.promise;
    };
    const reads = [cache.get("k", fetch), cache.get("k", fetch), cache.get("k", fetch)];
    // Another key is not coalesced with it.
    const other = cache.get("other", () => Promise.resolve("o"));
    pending.resolve("v");
    expect(await Promise.all(reads)).toEqual([
      { value: "v", stale: false },
      { value: "v", stale: false },
      { value: "v", stale: false },
    ]);
    expect(await other).toEqual({ value: "o", stale: false });
    expect(calls).toBe(1);
  });

  it("coalesced callers share a failure, and the next call tries again", async () => {
    const cache = new ProviderCache<string>(policy, clock().now);
    const pending = deferred<string>();
    let calls = 0;
    const failing = () => {
      calls += 1;
      return pending.promise;
    };
    const reads = [cache.get("k", failing), cache.get("k", failing)];
    pending.reject(new Error("down"));
    for (const read of reads) {
      await expect(read).rejects.toThrow("down");
    }
    expect(await cache.get("k", () => Promise.resolve("up"))).toEqual({
      value: "up",
      stale: false,
    });
    expect(calls).toBe(1);
  });

  it("serves an expired entry as stale when the provider fails, up to 72 h past its expiry", async () => {
    const time = clock();
    const cache = new ProviderCache<string>(policy, time.now);
    await cache.get("k", () => Promise.resolve("old"));
    const down = () => Promise.reject(new Error("down"));
    time.advance(24 * HOUR + 72 * HOUR - 1);
    expect(await cache.get("k", down)).toEqual({ value: "old", stale: true });
    time.advance(1);
    await expect(cache.get("k", down)).rejects.toThrow("down");
    // Past the window the entry is gone, even for a peek.
    expect(cache.peek("k", { allowStale: true })).toBeUndefined();
  });

  it("does not keep a stale answer: a later success replaces it", async () => {
    const time = clock();
    const cache = new ProviderCache<string>(policy, time.now);
    await cache.get("k", () => Promise.resolve("old"));
    time.advance(25 * HOUR);
    expect(await cache.get("k", () => Promise.reject(new Error("down")))).toEqual({
      value: "old",
      stale: true,
    });
    expect(await cache.get("k", () => Promise.resolve("new"))).toEqual({
      value: "new",
      stale: false,
    });
  });

  it("without any entry a provider failure is the caller's failure", async () => {
    const cache = new ProviderCache<string>(policy, clock().now);
    await expect(cache.get("k", () => Promise.reject(new Error("down")))).rejects.toThrow("down");
  });

  it("is bounded by entry count and evicts the least recently used entry", async () => {
    const cache = new ProviderCache<string>(policy, clock().now);
    for (const key of ["a", "b", "c"]) {
      await cache.get(key, () => Promise.resolve(key));
    }
    // Reading `a` makes `b` the least recently used one.
    expect(cache.peek("a")).toEqual({ value: "a", stale: false });
    await cache.get("d", () => Promise.resolve("d"));
    expect(cache.size()).toBe(3);
    expect(cache.peek("b")).toBeUndefined();
    expect(cache.peek("a")).toBeDefined();
    expect(cache.peek("c")).toBeDefined();
    expect(cache.peek("d")).toBeDefined();
  });

  it("peek never calls anything and tells fresh from stale", async () => {
    const time = clock();
    const cache = new ProviderCache<string>(policy, time.now);
    expect(cache.peek("k")).toBeUndefined();
    await cache.get("k", () => Promise.resolve("v"));
    time.advance(25 * HOUR);
    expect(cache.peek("k")).toBeUndefined();
    expect(cache.peek("k", { allowStale: true })).toEqual({ value: "v", stale: true });
  });

  it("refuses a policy without bounds", () => {
    expect(() => new ProviderCache<string>({ ...policy, maxEntries: 0 }, clock().now)).toThrow(
      RangeError,
    );
    expect(() => new ProviderCache<string>({ ...policy, ttlMs: 0 }, clock().now)).toThrow(
      RangeError,
    );
  });
});

describe("ConcurrencyGate (at most N provider calls in flight per provider)", () => {
  it("runs at most `maxInFlight` at once and queues the rest in order", async () => {
    const gate = new ConcurrencyGate(2, 10);
    const started: number[] = [];
    const gates = [deferred<undefined>(), deferred<undefined>(), deferred<undefined>()];
    const runs = gates.map((entry, index) =>
      gate.run(new AbortController().signal, async () => {
        started.push(index);
        await entry.promise;
        return index;
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    expect(gate.inFlight()).toBe(2);
    gates[0]?.resolve(undefined);
    await runs[0];
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);
    gates[1]?.resolve(undefined);
    gates[2]?.resolve(undefined);
    expect(await Promise.all(runs)).toEqual([0, 1, 2]);
    expect(gate.inFlight()).toBe(0);
  });

  it("refuses at once when the queue is full (a burst never piles up)", async () => {
    const gate = new ConcurrencyGate(1, 1);
    const block = deferred<undefined>();
    const first = gate.run(new AbortController().signal, () => block.promise);
    const second = gate.run(new AbortController().signal, () => Promise.resolve());
    await expect(
      gate.run(new AbortController().signal, () => Promise.resolve()),
    ).rejects.toBeInstanceOf(GateBusyError);
    block.resolve(undefined);
    await first;
    await second;
  });

  it("a queued call whose signal aborts leaves the queue and never runs", async () => {
    const gate = new ConcurrencyGate(1, 5);
    const block = deferred<undefined>();
    const first = gate.run(new AbortController().signal, () => block.promise);
    const controller = new AbortController();
    let ran = false;
    const queued = gate.run(controller.signal, () => {
      ran = true;
      return Promise.resolve();
    });
    controller.abort(new Error("timeout"));
    await expect(queued).rejects.toThrow("timeout");
    block.resolve(undefined);
    await first;
    expect(ran).toBe(false);
    expect(gate.queued()).toBe(0);
  });

  it("frees the slot when the work fails", async () => {
    const gate = new ConcurrencyGate(1, 1);
    await expect(
      gate.run(new AbortController().signal, () => Promise.reject(new Error("x"))),
    ).rejects.toThrow("x");
    expect(gate.inFlight()).toBe(0);
    expect(await gate.run(new AbortController().signal, () => Promise.resolve(7))).toBe(7);
  });
});
