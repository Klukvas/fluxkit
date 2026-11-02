import type { Failure } from "./failure";

/**
 * The quantity of ONE cart line, saved by itself (no "Update" button). Pure: timers and the save call are injected, the
 * cart page's island wires it to the cart store and React.
 *
 * Rules (each has a test, `quantity-autosave.spec.ts`):
 * - A change shows at once (`draft`) and is saved `delayMs` after the LAST change (debounce): rapid clicks are one request.
 * - One request per line at a time. A change made while a request runs is kept and saved after it: no update is lost and
 *   two writes of the same line never race.
 * - The draft is display only. The cart store still applies server answers only, so the price, the line total, the cart
 *   total and the stock are always the server's; the draft is dropped once the server's quantity equals it or a save ends.
 * - A failed save restores the server's quantity (the draft is dropped) and keeps the failure for the line, unless the
 *   shopper changed the quantity again meanwhile (then the newer choice is saved and the failure is not shown).
 */

export const QUANTITY_SAVE_DELAY_MS = 500;

export interface AutosaveState {
  /** The quantity the shopper chose and the server has not confirmed yet; `null` shows the server's quantity. */
  draft: number | null;
  /** A save of this line is waiting for its delay or for the server. */
  pending: boolean;
  /** The last save failed and the server's quantity is shown again. */
  failure: Failure | null;
}

export type SaveOutcome = { status: "ok" } | { status: "failed"; failure: Failure };

export interface QuantityAutosaveOptions {
  /** Sends the quantity; resolves when the cart store has applied the answer. Must not throw for an expected failure. */
  save(quantity: number): Promise<SaveOutcome>;
  /** The quantity of the line in the cart store right now (the server's). */
  serverQuantity(): number;
  delayMs?: number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface QuantityAutosave {
  getState(): AutosaveState;
  subscribe(listener: () => void): () => void;
  /** The shopper chose `quantity` (a step button or a typed number). */
  change(quantity: number): void;
  /** Saves a waiting change now (no delay); the island calls it when the page is left. */
  flush(): void;
  /** Stops the timer; an answer that arrives later is still applied by the store, but this line's state stays as is. */
  dispose(): void;
}

export const idleAutosave: AutosaveState = Object.freeze({
  draft: null,
  pending: false,
  failure: null,
});

export function createQuantityAutosave(options: QuantityAutosaveOptions): QuantityAutosave {
  const delayMs = options.delayMs ?? QUANTITY_SAVE_DELAY_MS;
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer =
    options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let state: AutosaveState = idleAutosave;
  let timer: unknown = null;
  let inFlight = false;
  let disposed = false;
  /** Bumped by every change, so a save can tell whether the shopper changed the quantity while it ran. */
  let version = 0;
  const listeners = new Set<() => void>();

  function set(next: AutosaveState): void {
    if (disposed) return;
    state = next;
    for (const listener of [...listeners]) listener();
  }

  function stopTimer(): void {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function send(): void {
    stopTimer();
    if (inFlight || disposed) return;
    const quantity = state.draft;
    if (quantity === null) return;
    if (quantity === options.serverQuantity()) {
      set({ draft: null, pending: false, failure: null });
      return;
    }
    inFlight = true;
    const sentVersion = version;
    void options.save(quantity).then(
      (outcome) => finished(outcome, sentVersion),
      (error: unknown) => {
        // A throw is a bug, not a refused save: free the line and stay loud.
        inFlight = false;
        set({ draft: null, pending: false, failure: null });
        throw error;
      },
    );
  }

  function finished(outcome: SaveOutcome, sentVersion: number): void {
    inFlight = false;
    if (version !== sentVersion) {
      // Changed while the request ran: save the newer choice (now, unless its own delay is still running).
      if (timer === null) send();
      return;
    }
    if (outcome.status === "ok") {
      set({ draft: null, pending: false, failure: null });
      return;
    }
    set({ draft: null, pending: false, failure: outcome.failure });
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    change(quantity) {
      if (disposed) return;
      version += 1;
      stopTimer();
      set({ draft: quantity, pending: true, failure: null });
      timer = setTimer(() => {
        timer = null;
        send();
      }, delayMs);
    },
    flush() {
      if (timer !== null) send();
    },
    dispose() {
      stopTimer();
      disposed = true;
      listeners.clear();
    },
  };
}
