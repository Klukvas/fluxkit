import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOOKUP_DEBOUNCE_MS,
  createLookupSource,
  type LookupPage,
  type LookupSource,
} from "./lookup-source";
import { NetworkError, type StoreResult } from "@fluxkit/api-client";

afterEach(() => vi.useRealTimers());

/** Lets promise callbacks run under fake timers (the real `settle()` waits on a timer that never fires). */
const settle = () => vi.advanceTimersByTimeAsync(0);

function page(...names: string[]): StoreResult<LookupPage<string>> {
  return { ok: true, status: 200, data: { items: names, total: names.length, stale: false } };
}

interface Pending {
  signal: AbortSignal;
  query: string;
  answer(result: StoreResult<LookupPage<string>>): void;
  fail(error: unknown): void;
}

function setup(options: { minChars?: number; searchEmpty?: boolean } = {}) {
  vi.useFakeTimers();
  const calls: Pending[] = [];
  const source: LookupSource<string> = createLookupSource<string>({
    minChars: options.minChars ?? 2,
    ...(options.searchEmpty === undefined ? {} : { searchEmpty: options.searchEmpty }),
    search: (query, signal) =>
      new Promise((resolve, reject) => {
        calls.push({ query, signal, answer: resolve, fail: reject });
      }),
  });
  return { source, calls };
}

describe("lookup source: debounce and minimum length", () => {
  it("asks 300 ms after the last keystroke, once, with the trimmed text", async () => {
    expect(LOOKUP_DEBOUNCE_MS).toBe(300);
    const { source, calls } = setup();
    source.setQuery("ky");
    expect(source.getState().status).toBe("waiting");
    vi.advanceTimersByTime(299);
    expect(calls).toHaveLength(0);
    source.setQuery(" kyi ");
    vi.advanceTimersByTime(299);
    expect(calls).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(calls.map((call) => call.query)).toEqual(["kyi"]);
    expect(source.getState().status).toBe("loading");
  });

  it("sends nothing below the minimum and drops the old results at once", async () => {
    const { source, calls } = setup();
    source.setQuery("kyiv");
    vi.advanceTimersByTime(300);
    calls[0]?.answer(page("Kyiv"));
    await settle();
    expect(source.getState().items).toEqual(["Kyiv"]);
    source.setQuery("k");
    expect(source.getState()).toMatchObject({ status: "idle", items: [], query: "k" });
    vi.advanceTimersByTime(1000);
    expect(calls).toHaveLength(1);
    // Spaces do not count.
    source.setQuery("  k ");
    vi.advanceTimersByTime(1000);
    expect(calls).toHaveLength(1);
  });

  it("clears the previous results as soon as the text changes (no option for text it does not match)", async () => {
    const { source, calls } = setup();
    source.setQuery("kyiv");
    vi.advanceTimersByTime(300);
    calls[0]?.answer(page("Kyiv"));
    await settle();
    source.setQuery("kyiv ");
    expect(source.getState().items).toEqual([]);
    source.setQuery("lv");
    expect(source.getState()).toMatchObject({ status: "waiting", items: [] });
  });

  it("with searchEmpty an empty box lists everything at once, without waiting", async () => {
    const { source, calls } = setup({ minChars: 1, searchEmpty: true });
    source.setQuery("");
    expect(calls.map((call) => call.query)).toEqual([""]);
    calls[0]?.answer(page("1", "2"));
    await settle();
    expect(source.getState()).toMatchObject({ status: "ready", items: ["1", "2"] });
  });
});

describe("lookup source: answers", () => {
  it("applies only the newest query's answer", async () => {
    const { source, calls } = setup();
    source.setQuery("ky");
    vi.advanceTimersByTime(300);
    source.setQuery("kyi");
    vi.advanceTimersByTime(300);
    const [older, newer] = calls;
    newer?.answer(page("Kyiv"));
    await settle();
    older?.answer(page("Kyivka", "Kyrylivka"));
    await settle();
    expect(source.getState()).toMatchObject({ status: "ready", query: "kyi", items: ["Kyiv"] });
  });

  it("drops the answer of a query the shopper deleted since", async () => {
    const { source, calls } = setup();
    source.setQuery("kyiv");
    vi.advanceTimersByTime(300);
    source.setQuery("");
    calls[0]?.answer(page("Kyiv"));
    await settle();
    expect(source.getState()).toMatchObject({ status: "idle", items: [] });
  });

  it("carries the API's count and stale flag", async () => {
    const { source, calls } = setup();
    source.setQuery("kyiv");
    vi.advanceTimersByTime(300);
    calls[0]?.answer({ ok: true, status: 200, data: { items: ["a"], total: 40, stale: true } });
    await settle();
    expect(source.getState()).toMatchObject({ total: 40, stale: true });
  });

  it("reports a refusal and a network failure as values with a retry that asks again", async () => {
    const { source, calls } = setup();
    source.setQuery("kyiv");
    vi.advanceTimersByTime(300);
    calls[0]?.answer({
      ok: false,
      status: 503,
      retryAfter: "30",
      problem: {
        type: "about:blank",
        title: "t",
        status: 503,
        code: "shipping_provider_unavailable",
        detail: "English",
      },
    });
    await settle();
    expect(source.getState()).toMatchObject({
      status: "error",
      failure: { messageKey: "errors.shipping_provider_unavailable", retryAfterSeconds: 30 },
    });
    source.retry();
    expect(calls.map((call) => call.query)).toEqual(["kyiv", "kyiv"]);
    calls[1]?.fail(
      new NetworkError("offline", { cause: new TypeError("offline"), aborted: false }),
    );
    await settle();
    expect(source.getState().failure?.messageKey).toBe("errors.network");
    source.retry();
    calls[2]?.answer(page("Kyiv"));
    await settle();
    expect(source.getState()).toMatchObject({ status: "ready", failure: null });
  });

  it("retry() does nothing unless the last lookup failed", () => {
    const { source, calls } = setup();
    source.retry();
    expect(calls).toHaveLength(0);
  });

  it("rethrows an aborted request (a bug) and leaves the box usable", async () => {
    const { source, calls } = setup();
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", record);
    try {
      source.setQuery("kyiv");
      vi.advanceTimersByTime(300);
      calls[0]?.fail(
        new NetworkError("stop", { cause: new DOMException("stop", "AbortError"), aborted: true }),
      );
      await settle();
      await settle();
    } finally {
      process.off("unhandledRejection", record);
    }
    expect(source.getState().status).toBe("idle");
    expect(unhandled).toHaveLength(1);
    expect(unhandled[0]).toBeInstanceOf(NetworkError);
  });

  it("aborts the request in flight when the text changes, so a stale answer is never even read", async () => {
    const { source, calls } = setup();
    source.setQuery("kyiv");
    vi.advanceTimersByTime(300);
    const first = calls[0];
    expect(first?.signal.aborted).toBe(false);
    source.setQuery("kyiv oblast");
    expect(first?.signal.aborted).toBe(true);
    vi.advanceTimersByTime(300);
    const second = calls[1];
    expect(second?.signal.aborted).toBe(false);
    // The aborted request rejects: that is not a failure and not a bug, the newer query owns the state.
    first?.fail(
      new NetworkError("stop", { cause: new DOMException("stop", "AbortError"), aborted: true }),
    );
    await settle();
    expect(source.getState()).toMatchObject({ status: "loading", query: "kyiv oblast" });
    second?.answer(page("Kyiv oblast"));
    await settle();
    expect(source.getState()).toMatchObject({ status: "ready", items: ["Kyiv oblast"] });
    // An answered request is not aborted afterwards.
    expect(second?.signal.aborted).toBe(false);
  });

  it("aborts the request in flight when the text falls below the minimum, on reset() and on dispose()", () => {
    const { source, calls } = setup();
    source.setQuery("kyiv");
    vi.advanceTimersByTime(300);
    source.setQuery("k");
    expect(calls[0]?.signal.aborted).toBe(true);
    source.setQuery("lviv");
    vi.advanceTimersByTime(300);
    source.reset();
    expect(calls[1]?.signal.aborted).toBe(true);
    source.setQuery("odesa");
    vi.advanceTimersByTime(300);
    source.dispose();
    expect(calls[2]?.signal.aborted).toBe(true);
  });

  it("asks again on retry() with a fresh, live signal", () => {
    const { source, calls } = setup();
    source.setQuery("kyiv");
    vi.advanceTimersByTime(300);
    calls[0]?.answer({
      ok: false,
      status: 503,
      problem: { type: "t", title: "t", status: 503, code: "search_unavailable", detail: "d" },
      retryAfter: null,
    });
    return settle().then(() => {
      source.retry();
      expect(calls).toHaveLength(2);
      expect(calls[1]?.signal.aborted).toBe(false);
    });
  });

  it("reset() and dispose() cancel a pending search", () => {
    const { source, calls } = setup();
    source.setQuery("kyiv");
    source.reset();
    vi.advanceTimersByTime(1000);
    expect(calls).toHaveLength(0);
    source.setQuery("kyiv");
    source.dispose();
    vi.advanceTimersByTime(1000);
    expect(calls).toHaveLength(0);
  });
});
