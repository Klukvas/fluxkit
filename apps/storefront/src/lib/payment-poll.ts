import type { PaymentState, ShopperPaymentStatus, StoreResult } from "@fluxkit/api-client";
import { failureFromResult, failureFromThrown, retryAfterSeconds, type Failure } from "./failure";

/**
 * The return page's watch over ONE payment attempt (ADR 0032 decision 6: "polls every 3 s for at most 2 minutes, then says the
 * order will update"). A small state machine around an injected `read` (the typed client's status route), so every rule is
 * tested with fake timers and no browser:
 *
 * - the first read is at once; the next one is planned only AFTER an answer (never two reads in flight);
 * - `paid`, `failed` and `expired` are final and end the watch; `waiting` and `processing` keep it going;
 * - the budget is 40 follow-up reads, 3 seconds apart (2 minutes); then the phase is `timedOut` (the page says the order
 *   will update by itself) and a button can start a fresh budget with `retry()`;
 * - `404`/`400` is one "not found" (an unknown attempt, another order's, a wrong token: nothing is told apart), `401` ends
 *   the watch as `signedOut`;
 * - a failed read (network, timeout, 5xx, 429) keeps the last known state and is tried again; three in a row end the watch
 *   as `error` (with the last known state), so a dead API does not keep a tab polling for ever;
 * - a `429` waits for the longer of the interval and its `Retry-After`.
 *
 * The state shown is ONLY what the API answered. Nothing here reads the address bar.
 */

export const PAYMENT_POLL_INTERVAL_MS = 3_000;
/** Follow-up reads after the first one: 40 x 3 s = 2 minutes. */
export const PAYMENT_POLL_MAX_FOLLOW_UPS = 40;
/** Failed reads in a row after which the watch gives up. */
export const PAYMENT_POLL_MAX_FAILURES = 3;

export function isFinalPayment(status: ShopperPaymentStatus): boolean {
  return status === "paid" || status === "failed" || status === "expired";
}

export type PaymentWatchState =
  | { phase: "loading" }
  /** The attempt is open (`waiting` or `processing`); the watch is still reading. */
  | { phase: "watching"; payment: PaymentState }
  | { phase: "final"; payment: PaymentState }
  /** The budget ran out and the attempt is still open: the order updates by itself when the bank answers. */
  | { phase: "timedOut"; payment: PaymentState }
  | { phase: "notFound" }
  | { phase: "signedOut" }
  | { phase: "error"; failure: Failure; last: PaymentState | null };

export interface PaymentWatchTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface PaymentWatch {
  getState(): PaymentWatchState;
  subscribe(listener: () => void): () => void;
  /** Starts the watch; a second call while it runs does nothing. */
  start(): void;
  /** A fresh budget after `timedOut` or `error`; nothing in any other phase. */
  retry(): void;
  /** Ends the watch: the timer is cleared and an answer that arrives later is ignored. */
  dispose(): void;
}

const browserTimers: PaymentWatchTimers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createPaymentWatch(options: {
  read: () => Promise<StoreResult<PaymentState>>;
  timers?: PaymentWatchTimers;
  intervalMs?: number;
  maxFollowUps?: number;
}): PaymentWatch {
  const timers = options.timers ?? browserTimers;
  const intervalMs = options.intervalMs ?? PAYMENT_POLL_INTERVAL_MS;
  const maxFollowUps = options.maxFollowUps ?? PAYMENT_POLL_MAX_FOLLOW_UPS;
  let state: PaymentWatchState = { phase: "loading" };
  const listeners = new Set<() => void>();
  let timer: unknown = null;
  let running = false;
  let disposed = false;
  let followUps = 0;
  let failures = 0;
  let last: PaymentState | null = null;

  function set(next: PaymentWatchState): void {
    state = next;
    for (const listener of [...listeners]) listener();
  }

  function schedule(delayMs: number): void {
    timer = timers.setTimeout(() => {
      timer = null;
      void poll();
    }, delayMs);
  }

  /** The state after a failed read: the last known one is kept, and the watch gives up after a run of failures. */
  function failed(failure: Failure, waitMs: number): void {
    failures += 1;
    if (failures >= PAYMENT_POLL_MAX_FAILURES) {
      running = false;
      set({ phase: "error", failure, last });
      return;
    }
    next(waitMs);
  }

  /** Plans the next read, or ends the watch when the budget is used. */
  function next(waitMs: number): void {
    if (followUps >= maxFollowUps) {
      running = false;
      set(
        last === null
          ? { phase: "error", failure: noAnswerFailure(), last: null }
          : { phase: "timedOut", payment: last },
      );
      return;
    }
    followUps += 1;
    schedule(waitMs);
  }

  async function poll(): Promise<void> {
    let result: StoreResult<PaymentState>;
    try {
      result = await options.read();
    } catch (error) {
      if (disposed) return;
      // A network failure or a timeout is retried; an abort or a bug is rethrown by `failureFromThrown`.
      failed(failureFromThrown(error), intervalMs);
      return;
    }
    if (disposed) return;
    if (result.ok) {
      failures = 0;
      last = result.data;
      if (isFinalPayment(result.data.status)) {
        running = false;
        set({ phase: "final", payment: result.data });
        return;
      }
      set({ phase: "watching", payment: result.data });
      next(intervalMs);
      return;
    }
    if (result.status === 401) {
      running = false;
      set({ phase: "signedOut" });
      return;
    }
    if (result.status === 404 || result.status === 400) {
      running = false;
      set({ phase: "notFound" });
      return;
    }
    const wait = retryAfterSeconds(result.retryAfter);
    failed(failureFromResult(result), Math.max(intervalMs, (wait ?? 0) * 1000));
  }

  function begin(): void {
    running = true;
    followUps = 0;
    failures = 0;
    void poll();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (running || disposed || state.phase !== "loading") return;
      begin();
    },
    retry() {
      if (running || disposed) return;
      if (state.phase !== "timedOut" && state.phase !== "error") return;
      if (last !== null) set({ phase: "watching", payment: last });
      else set({ phase: "loading" });
      begin();
    },
    dispose() {
      disposed = true;
      running = false;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
    },
  };
}

/** Only reachable when the budget is zero and nothing was ever read; a defined state instead of a throw. */
function noAnswerFailure(): Failure {
  return {
    messageKey: "errors.generic",
    status: null,
    code: null,
    retryAfterSeconds: null,
    fieldErrors: [],
  };
}
