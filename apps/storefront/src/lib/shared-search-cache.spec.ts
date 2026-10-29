import type { SearchResult } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import { createSharedSearchCache } from "./shared-search-cache";
import type { SearchOutcome } from "./search-data";

function result(total: number): SearchResult {
  return {
    items: [],
    total,
    page: 1,
    pageCount: 1,
    limit: 24,
    sort: "newest",
    relaxed: false,
    query: { normalized: "" },
    facets: [],
    price: null,
  };
}

const ok = (total: number): SearchOutcome => ({ kind: "results", result: result(total) });
const limited: SearchOutcome = { kind: "rate_limited", retryAfterSeconds: 30 };
const down: SearchOutcome = { kind: "unavailable", retryAfterSeconds: null };

function setup(options: { maxEntries?: number } = {}) {
  let clock = 1_000_000;
  const cache = createSharedSearchCache({
    maxEntries: options.maxEntries ?? 10,
    freshMs: 60_000,
    staleMs: 300_000,
    now: () => clock,
  });
  const loads: string[] = [];
  const read = (key: string, outcome: SearchOutcome) =>
    cache.read(key, async () => {
      loads.push(key);
      return outcome;
    });
  return {
    cache,
    read,
    loads,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("shared search cache (the unfiltered catalog lists, review F1)", () => {
  it("answers a fresh entry without reading the API again", async () => {
    const { read, loads, advance } = setup();
    expect(await read("a", ok(1))).toEqual(ok(1));
    advance(59_999);
    expect(await read("a", ok(2))).toEqual(ok(1));
    expect(loads).toEqual(["a"]);
  });

  it("reads again once the entry is older than the fresh window and keeps the new answer", async () => {
    const { read, loads, advance } = setup();
    await read("a", ok(1));
    advance(60_000);
    expect(await read("a", ok(2))).toEqual(ok(2));
    expect(await read("a", ok(3))).toEqual(ok(2));
    expect(loads).toEqual(["a", "a"]);
  });

  for (const failure of [limited, down]) {
    it(`serves the last good answer when a re-read answers ${failure.kind}, within the stale window`, async () => {
      const { read, advance } = setup();
      await read("a", ok(1));
      advance(60_000 + 300_000 - 1);
      expect(await read("a", failure)).toEqual(ok(1));
    });

    it(`answers ${failure.kind} on a cold miss and past the stale window (then the page falls back and says so)`, async () => {
      const { read, advance } = setup();
      expect(await read("cold", failure)).toEqual(failure);
      await read("a", ok(1));
      advance(60_000 + 300_000);
      expect(await read("a", failure)).toEqual(failure);
    });
  }

  it("never keeps a failure: the next read asks the API again", async () => {
    const { read, loads } = setup();
    await read("a", limited);
    expect(await read("a", ok(1))).toEqual(ok(1));
    expect(loads).toEqual(["a", "a"]);
  });

  it("drops the entry when search is switched off or the selection is refused: those are answers, not outages", async () => {
    const { read, advance, cache } = setup();
    await read("a", ok(1));
    advance(60_000);
    expect(await read("a", { kind: "disabled" })).toEqual({ kind: "disabled" });
    expect(cache.size()).toBe(0);
    expect(await read("a", limited)).toEqual(limited);
    await read("b", ok(1));
    advance(60_000);
    expect(await read("b", { kind: "invalid", reason: "filter" })).toEqual({
      kind: "invalid",
      reason: "filter",
    });
    expect(cache.size()).toBe(0);
  });

  it("does not catch a thrown read (an engine refusal stays loud)", async () => {
    const { cache } = setup();
    await expect(cache.read("a", () => Promise.reject(new Error("answered 500")))).rejects.toThrow(
      /500/,
    );
    expect(cache.size()).toBe(0);
  });

  it("holds at most maxEntries, dropping the least recently used", async () => {
    const { read, loads, cache } = setup({ maxEntries: 2 });
    await read("a", ok(1));
    await read("b", ok(2));
    await read("a", ok(9)); // a is now the most recent
    await read("c", ok(3)); // b goes
    expect(cache.size()).toBe(2);
    expect(await read("a", ok(9))).toEqual(ok(1));
    expect(await read("b", ok(4))).toEqual(ok(4));
    expect(loads).toEqual(["a", "b", "c", "b"]);
  });

  it("reads a key once for concurrent misses", async () => {
    const { cache } = setup();
    let release: (value: SearchOutcome) => void = () => undefined;
    let loads = 0;
    const load = () => {
      loads += 1;
      return new Promise<SearchOutcome>((resolve) => {
        release = resolve;
      });
    };
    const first = cache.read("a", load);
    const second = cache.read("a", load);
    release(ok(1));
    expect(await first).toEqual(ok(1));
    expect(await second).toEqual(ok(1));
    expect(loads).toBe(1);
  });

  it("refuses options that would make the cache unbounded", () => {
    expect(() => createSharedSearchCache({ maxEntries: 0, freshMs: 1, staleMs: 0 })).toThrow();
    expect(() =>
      createSharedSearchCache({ maxEntries: 1, freshMs: 1, staleMs: Number.POSITIVE_INFINITY }),
    ).toThrow();
  });
});
