import { describe, expect, it } from "vitest";
import { createFreshAnswerCache } from "./fresh-answer-cache";

type Answer = { found: boolean; version: number };

function setup(maxEntries = 10) {
  let clock = 0;
  const cache = createFreshAnswerCache<Answer>({
    maxEntries,
    freshMs: 60_000,
    isKept: (answer) => answer.version >= 0,
    now: () => clock,
  });
  let reads = 0;
  const load =
    (answer: Omit<Answer, "version"> & { version?: number } = { found: true }) =>
    async (): Promise<Answer> => {
      reads += 1;
      return { found: answer.found, version: answer.version ?? reads };
    };
  return {
    cache,
    load,
    reads: () => reads,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("createFreshAnswerCache", () => {
  it("serves a fresh answer without a read and reads again once it is older than the window", async () => {
    const { cache, load, reads, advance } = setup();
    expect(await cache.read("a", load())).toEqual({ found: true, version: 1 });
    advance(59_999);
    expect(await cache.read("a", load())).toEqual({ found: true, version: 1 });
    expect(reads()).toBe(1);
    advance(1);
    expect(await cache.read("a", load())).toEqual({ found: true, version: 2 });
    expect(reads()).toBe(2);
  });

  it("lets a kept 'not found' replace a kept answer once the window is over (an unpublished product)", async () => {
    const { cache, load, advance } = setup();
    await cache.read("a", load({ found: true }));
    advance(60_000);
    expect(await cache.read("a", load({ found: false }))).toEqual({ found: false, version: 2 });
    advance(30_000);
    expect(await cache.read("a", load({ found: true }))).toEqual({ found: false, version: 2 });
  });

  it("returns an answer isKept refuses without keeping it, and drops the older entry of its key", async () => {
    const { cache, load, reads, advance } = setup();
    await cache.read("a", load());
    advance(60_000);
    expect(await cache.read("a", load({ found: true, version: -1 }))).toEqual({
      found: true,
      version: -1,
    });
    expect(await cache.read("a", load())).toEqual({ found: true, version: 3 });
    expect(reads()).toBe(3);
  });

  it("does not catch a read that throws and keeps nothing for it", async () => {
    const { cache, load, reads } = setup();
    const failure = new Error("unavailable");
    await expect(
      cache.read("a", () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    await expect(cache.read("a", () => Promise.reject(failure))).rejects.toBe(failure);
    expect(await cache.read("a", load())).toEqual({ found: true, version: 1 });
    expect(reads()).toBe(1);
  });

  it("keeps keys apart", async () => {
    const { cache, load, reads } = setup();
    await cache.read("a", load());
    expect(await cache.read("b", load({ found: false }))).toEqual({ found: false, version: 2 });
    expect(await cache.read("a", load())).toEqual({ found: true, version: 1 });
    expect(reads()).toBe(2);
  });

  it("drops the least recently used entry above the limit", async () => {
    const { cache, load, reads } = setup(2);
    await cache.read("a", load());
    await cache.read("b", load());
    await cache.read("a", load());
    await cache.read("c", load());
    expect(reads()).toBe(3);
    await cache.read("a", load());
    expect(reads()).toBe(3);
    await cache.read("b", load());
    expect(reads()).toBe(4);
  });

  it("shares one read between concurrent misses of one key", async () => {
    const { cache } = setup();
    let release: (answer: Answer) => void = () => {};
    let reads = 0;
    const slow = () =>
      new Promise<Answer>((resolve) => {
        reads += 1;
        release = resolve;
      });
    const first = cache.read("a", slow);
    const second = cache.read("a", slow);
    release({ found: true, version: 7 });
    expect(await Promise.all([first, second])).toEqual([
      { found: true, version: 7 },
      { found: true, version: 7 },
    ]);
    expect(reads).toBe(1);
  });

  it("refuses a limit below one entry and a negative or infinite window", () => {
    const isKept = () => true;
    expect(() => createFreshAnswerCache({ maxEntries: 0, freshMs: 1, isKept })).toThrow();
    expect(() => createFreshAnswerCache({ maxEntries: 1.5, freshMs: 1, isKept })).toThrow();
    expect(() => createFreshAnswerCache({ maxEntries: 1, freshMs: -1, isKept })).toThrow();
    expect(() =>
      createFreshAnswerCache({ maxEntries: 1, freshMs: Number.POSITIVE_INFINITY, isKept }),
    ).toThrow();
  });
});
