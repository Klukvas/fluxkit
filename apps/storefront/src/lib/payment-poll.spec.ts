import { NetworkError, type PaymentState, type StoreResult } from "@fluxkit/api-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PAYMENT_POLL_INTERVAL_MS,
  PAYMENT_POLL_MAX_FOLLOW_UPS,
  createPaymentWatch,
  isFinalPayment,
} from "./payment-poll";

const ID = "6f1c1d8e-5f0a-4f6e-9a0b-0c2f4b7d1a11";

function state(overrides: Partial<PaymentState> = {}): PaymentState {
  return {
    paymentId: ID,
    status: "processing",
    failureCategory: null,
    expiresAt: "2026-10-29T12:00:00.000Z",
    orderStatus: "awaiting_payment",
    canRetry: false,
    ...overrides,
  };
}

const ok = (payment: PaymentState): StoreResult<PaymentState> => ({
  ok: true,
  status: 200,
  data: payment,
});

function problem(status: number, code: string, retryAfter: string | null = null) {
  return {
    ok: false,
    status,
    problem: { type: "about:blank", title: "t", status, code, detail: "never shown" },
    retryAfter,
  } as StoreResult<PaymentState>;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Lets the promise chain of a read settle without moving the clock. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe("isFinalPayment", () => {
  it("is true for paid, failed and expired and false while the attempt is open", () => {
    expect(isFinalPayment("paid")).toBe(true);
    expect(isFinalPayment("failed")).toBe(true);
    expect(isFinalPayment("expired")).toBe(true);
    expect(isFinalPayment("waiting")).toBe(false);
    expect(isFinalPayment("processing")).toBe(false);
  });
});

describe("createPaymentWatch", () => {
  it("reads at once, then every 3 seconds while the attempt is open", async () => {
    const read = vi.fn(() => Promise.resolve(ok(state({ status: "waiting" }))));
    const watch = createPaymentWatch({ read });
    expect(watch.getState().phase).toBe("loading");
    watch.start();
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
    expect(watch.getState()).toMatchObject({ phase: "watching", payment: { status: "waiting" } });

    await vi.advanceTimersByTimeAsync(PAYMENT_POLL_INTERVAL_MS - 1);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(PAYMENT_POLL_INTERVAL_MS);
    expect(read).toHaveBeenCalledTimes(3);
    watch.dispose();
  });

  it.each(["paid", "failed", "expired"] as const)(
    "stops at the final status %s and leaves no timer",
    async (status) => {
      const answers = [state({ status: "processing" }), state({ status })];
      const read = vi.fn(() => Promise.resolve(ok(answers.shift() ?? state({ status }))));
      const watch = createPaymentWatch({ read });
      watch.start();
      await vi.advanceTimersByTimeAsync(PAYMENT_POLL_INTERVAL_MS);
      expect(watch.getState()).toMatchObject({ phase: "final", payment: { status } });
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(10 * PAYMENT_POLL_INTERVAL_MS);
      expect(read).toHaveBeenCalledTimes(2);
    },
  );

  it("stops after the budget (2 minutes) when the attempt never settles, and says so", async () => {
    expect(PAYMENT_POLL_MAX_FOLLOW_UPS * PAYMENT_POLL_INTERVAL_MS).toBe(120_000);
    const read = vi.fn(() => Promise.resolve(ok(state({ status: "processing" }))));
    const watch = createPaymentWatch({ read });
    watch.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(read).toHaveBeenCalledTimes(1 + PAYMENT_POLL_MAX_FOLLOW_UPS);
    expect(watch.getState()).toMatchObject({
      phase: "timedOut",
      payment: { status: "processing" },
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never has two reads in flight: the next one is planned only after the answer", async () => {
    let finish: (result: StoreResult<PaymentState>) => void = () => {};
    const read = vi.fn(
      () =>
        new Promise<StoreResult<PaymentState>>((resolve) => {
          finish = resolve;
        }),
    );
    const watch = createPaymentWatch({ read });
    watch.start();
    watch.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(1);
    finish(ok(state({ status: "waiting" })));
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(PAYMENT_POLL_INTERVAL_MS);
    expect(read).toHaveBeenCalledTimes(2);
    watch.dispose();
  });

  it("shows one not-found state for 404 and 400 and stops", async () => {
    for (const status of [404, 400]) {
      const read = vi.fn(() => Promise.resolve(problem(status, "not_found")));
      const watch = createPaymentWatch({ read });
      watch.start();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(watch.getState().phase).toBe("notFound");
      expect(read).toHaveBeenCalledTimes(1);
    }
  });

  it("stops with signedOut on 401", async () => {
    const read = vi.fn(() => Promise.resolve(problem(401, "unauthorized")));
    const watch = createPaymentWatch({ read });
    watch.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(watch.getState().phase).toBe("signedOut");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("survives two failed reads in a row, keeps the last known state, and stops with an error at the third", async () => {
    const answers: (StoreResult<PaymentState> | Error)[] = [
      ok(state({ status: "waiting" })),
      problem(503, "service_unavailable"),
      new NetworkError("down", { cause: new TypeError("fetch failed"), aborted: false }),
      problem(503, "service_unavailable"),
    ];
    const read = vi.fn(() => {
      const next = answers.shift() ?? problem(503, "service_unavailable");
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    });
    const watch = createPaymentWatch({ read });
    watch.start();
    await settle();
    await vi.advanceTimersByTimeAsync(PAYMENT_POLL_INTERVAL_MS);
    expect(watch.getState()).toMatchObject({ phase: "watching", payment: { status: "waiting" } });
    await vi.advanceTimersByTimeAsync(PAYMENT_POLL_INTERVAL_MS);
    expect(watch.getState().phase).toBe("watching");
    await vi.advanceTimersByTimeAsync(PAYMENT_POLL_INTERVAL_MS);
    expect(watch.getState()).toMatchObject({ phase: "error", last: { status: "waiting" } });
    expect(vi.getTimerCount()).toBe(0);
    expect(read).toHaveBeenCalledTimes(4);
  });

  it("a success resets the run of failures", async () => {
    const answers = [
      problem(503, "service_unavailable"),
      problem(503, "service_unavailable"),
      ok(state({ status: "waiting" })),
      problem(503, "service_unavailable"),
      problem(503, "service_unavailable"),
      ok(state({ status: "paid" })),
    ];
    const read = vi.fn(() => Promise.resolve(answers.shift() ?? ok(state({ status: "paid" }))));
    const watch = createPaymentWatch({ read });
    watch.start();
    await vi.advanceTimersByTimeAsync(10 * PAYMENT_POLL_INTERVAL_MS);
    expect(watch.getState()).toMatchObject({ phase: "final", payment: { status: "paid" } });
  });

  it("waits for the longer of the interval and Retry-After after a 429", async () => {
    const answers = [problem(429, "too_many_requests", "10"), ok(state({ status: "waiting" }))];
    const read = vi.fn(() => Promise.resolve(answers.shift() ?? ok(state({ status: "waiting" }))));
    const watch = createPaymentWatch({ read });
    watch.start();
    await settle();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    watch.dispose();
  });

  it("retry() starts a fresh budget after a timeout or an error", async () => {
    const read = vi.fn(() => Promise.resolve(ok(state({ status: "processing" }))));
    const watch = createPaymentWatch({ read });
    watch.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(watch.getState().phase).toBe("timedOut");
    const before = read.mock.calls.length;
    watch.retry();
    await settle();
    expect(watch.getState().phase).toBe("watching");
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(read.mock.calls.length).toBe(before * 2);
    expect(watch.getState().phase).toBe("timedOut");
  });

  it("retry() does nothing while the attempt is being watched or is final", async () => {
    const read = vi.fn(() => Promise.resolve(ok(state({ status: "paid" }))));
    const watch = createPaymentWatch({ read });
    watch.start();
    await settle();
    watch.retry();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("dispose() cancels the timer and ignores an answer that arrives later", async () => {
    let finish: (result: StoreResult<PaymentState>) => void = () => {};
    const read = vi.fn(
      () =>
        new Promise<StoreResult<PaymentState>>((resolve) => {
          finish = resolve;
        }),
    );
    const listener = vi.fn();
    const watch = createPaymentWatch({ read });
    watch.subscribe(listener);
    watch.start();
    watch.dispose();
    finish(ok(state({ status: "paid" })));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(watch.getState().phase).toBe("loading");
    expect(vi.getTimerCount()).toBe(0);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("notifies subscribers on every change and stops after unsubscribe", async () => {
    const read = vi.fn(() => Promise.resolve(ok(state({ status: "paid" }))));
    const listener = vi.fn();
    const watch = createPaymentWatch({ read });
    const unsubscribe = watch.subscribe(listener);
    watch.start();
    await settle();
    expect(listener).toHaveBeenCalled();
    const calls = listener.mock.calls.length;
    unsubscribe();
    watch.retry();
    expect(listener.mock.calls.length).toBe(calls);
  });
});
