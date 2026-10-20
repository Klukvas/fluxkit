import { NetworkError } from "@fluxkit/api-client";
import { describe, expect, it, vi } from "vitest";
import {
  BROWSER_READ_TIMEOUT_MS,
  BROWSER_WRITE_TIMEOUT_MS,
  isTimeout,
  withTimeout,
} from "./request-timeout";

describe("timeouts", () => {
  it("bounds reads (15 s) shorter than writes (30 s)", () => {
    expect(BROWSER_READ_TIMEOUT_MS).toBe(15_000);
    expect(BROWSER_WRITE_TIMEOUT_MS).toBe(30_000);
  });
});

describe("withTimeout", () => {
  function setup() {
    const calls: { url: string; init: RequestInit }[] = [];
    const wanted: number[] = [];
    const controllers: AbortController[] = [];
    const fetched = withTimeout(
      async (url, init) => {
        calls.push({ url, init });
        return new Response("{}");
      },
      {
        signalFor: (ms) => {
          wanted.push(ms);
          const controller = new AbortController();
          controllers.push(controller);
          return controller.signal;
        },
      },
    );
    return { fetched, calls, wanted, controllers };
  }

  it("gives every GET the read limit and every write the write limit, and always a signal", async () => {
    const { fetched, calls, wanted } = setup();
    await fetched("/admin/orders", { method: "GET" });
    await fetched("/admin/orders", {});
    await fetched("/admin/products", { method: "POST" });
    await fetched("/admin/orders/x/mark-paid", { method: "POST" });
    await fetched("/admin/products/x", { method: "DELETE" });
    await fetched("/admin/products/x", { method: "PUT" });
    expect(wanted).toEqual([
      BROWSER_READ_TIMEOUT_MS,
      BROWSER_READ_TIMEOUT_MS,
      BROWSER_WRITE_TIMEOUT_MS,
      BROWSER_WRITE_TIMEOUT_MS,
      BROWSER_WRITE_TIMEOUT_MS,
      BROWSER_WRITE_TIMEOUT_MS,
    ]);
    for (const call of calls) expect(call.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps the other init fields (method, headers, body, credentials)", async () => {
    const { fetched, calls } = setup();
    await fetched("/x", { method: "POST", body: "b", credentials: "include", headers: { a: "b" } });
    expect(calls[0]?.init).toMatchObject({ method: "POST", body: "b", credentials: "include" });
  });

  it("ends the request when the limit passes, and when the caller's own signal aborts", async () => {
    const calls: AbortSignal[] = [];
    const timer = new AbortController();
    const fetched = withTimeout(
      (_url, init) => {
        calls.push(init.signal as AbortSignal);
        return new Promise<Response>(() => undefined);
      },
      { signalFor: () => timer.signal },
    );
    const caller = new AbortController();
    void fetched("/x", { signal: caller.signal });
    void fetched("/y", {});
    expect(calls.map((signal) => signal.aborted)).toEqual([false, false]);
    caller.abort();
    expect(calls.map((signal) => signal.aborted)).toEqual([true, false]);
    timer.abort();
    expect(calls.map((signal) => signal.aborted)).toEqual([true, true]);
  });

  it("really times out with the default signal (fake timers)", async () => {
    vi.useFakeTimers();
    try {
      let seen: AbortSignal | undefined;
      const fetched = withTimeout(
        (_url, init) => {
          seen = init.signal as AbortSignal;
          return new Promise<Response>((_resolve, reject) => {
            seen?.addEventListener("abort", () => {
              reject(seen?.reason);
            });
          });
        },
        { readMs: 50, writeMs: 100 },
      );
      const pending = fetched("/x", { method: "GET" }).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(49);
      expect(seen?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(isTimeout(await pending)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("isTimeout", () => {
  const timedOut = () => new DOMException("The operation timed out.", "TimeoutError");

  it("recognises a TimeoutError, directly and as the cause of a NetworkError", () => {
    expect(isTimeout(timedOut())).toBe(true);
    expect(isTimeout(new NetworkError("x", { cause: timedOut(), aborted: true }))).toBe(true);
  });

  it("does not take a user abort, a refused connection or a bug for a timeout", () => {
    expect(isTimeout(new DOMException("aborted", "AbortError"))).toBe(false);
    expect(
      isTimeout(
        new NetworkError("x", { cause: new DOMException("aborted", "AbortError"), aborted: true }),
      ),
    ).toBe(false);
    expect(
      isTimeout(new NetworkError("x", { cause: new TypeError("fetch failed"), aborted: false })),
    ).toBe(false);
    expect(isTimeout(new TypeError("bug"))).toBe(false);
    expect(isTimeout(undefined)).toBe(false);
    expect(isTimeout("TimeoutError")).toBe(false);
  });

  it("stops at a cause cycle", () => {
    const first: { name: string; cause?: unknown } = { name: "A" };
    first.cause = first;
    expect(isTimeout(first)).toBe(false);
  });
});
