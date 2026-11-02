import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientFailure } from "./failure";
import { createQuantityAutosave, type SaveOutcome } from "./quantity-autosave";

/** A save whose answer the test releases by hand, and a server quantity that follows a successful save (like the store). */
function harness(initial = 1) {
  let server = initial;
  const sent: number[] = [];
  const answers: ((outcome: SaveOutcome) => void)[] = [];
  const autosave = createQuantityAutosave({
    serverQuantity: () => server,
    save: (quantity) => {
      sent.push(quantity);
      return new Promise<SaveOutcome>((resolve) => {
        answers.push((outcome) => {
          if (outcome.status === "ok") server = quantity;
          resolve(outcome);
        });
      });
    },
  });
  return {
    autosave,
    sent,
    answer: async (outcome: SaveOutcome = { status: "ok" }) => {
      const next = answers.shift();
      if (next === undefined) throw new Error("no request is waiting");
      next(outcome);
      await vi.advanceTimersByTimeAsync(0);
    },
    shown: () => autosave.getState().draft ?? server,
  };
}

const refused = clientFailure("errors.rule.quantity_limit");

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("cart line quantity autosave", () => {
  it("shows a change at once and saves it 500 ms after the last change (debounce)", async () => {
    const line = harness(1);
    line.autosave.change(2);
    expect(line.shown()).toBe(2);
    expect(line.autosave.getState().pending).toBe(true);
    await vi.advanceTimersByTimeAsync(499);
    expect(line.sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(line.sent).toEqual([2]);
    await line.answer();
    expect(line.autosave.getState()).toEqual({ draft: null, pending: false, failure: null });
    expect(line.shown()).toBe(2);
  });

  it("turns rapid clicks into one request with the last quantity", async () => {
    const line = harness(1);
    for (const quantity of [2, 3, 4, 5]) {
      line.autosave.change(quantity);
      await vi.advanceTimersByTimeAsync(200);
    }
    expect(line.sent).toEqual([]);
    expect(line.shown()).toBe(5);
    await vi.advanceTimersByTimeAsync(300);
    expect(line.sent).toEqual([5]);
  });

  it("loses no update: a change made while a request runs is saved after it, never in parallel", async () => {
    const line = harness(1);
    line.autosave.change(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(line.sent).toEqual([2]);
    line.autosave.change(3);
    await vi.advanceTimersByTimeAsync(500);
    // The first request still runs: the second waits.
    expect(line.sent).toEqual([2]);
    expect(line.shown()).toBe(3);
    await line.answer();
    expect(line.sent).toEqual([2, 3]);
    expect(line.shown()).toBe(3);
    await line.answer();
    expect(line.autosave.getState()).toEqual({ draft: null, pending: false, failure: null });
    expect(line.shown()).toBe(3);
  });

  it("restores the server's quantity and keeps the reason when a save fails", async () => {
    const line = harness(2);
    line.autosave.change(9);
    await vi.advanceTimersByTimeAsync(500);
    await line.answer({ status: "failed", failure: refused });
    expect(line.autosave.getState()).toEqual({ draft: null, pending: false, failure: refused });
    expect(line.shown()).toBe(2);
  });

  it("clears the failure with the next change", async () => {
    const line = harness(2);
    line.autosave.change(9);
    await vi.advanceTimersByTimeAsync(500);
    await line.answer({ status: "failed", failure: refused });
    line.autosave.change(3);
    expect(line.autosave.getState().failure).toBeNull();
  });

  it("saves the newer choice instead of rolling back when the shopper changed it while a failing save ran", async () => {
    const line = harness(1);
    line.autosave.change(9);
    await vi.advanceTimersByTimeAsync(500);
    line.autosave.change(4);
    await line.answer({ status: "failed", failure: refused });
    expect(line.shown()).toBe(4);
    expect(line.autosave.getState().failure).toBeNull();
    await vi.advanceTimersByTimeAsync(500);
    expect(line.sent).toEqual([9, 4]);
    await line.answer();
    expect(line.shown()).toBe(4);
  });

  it("sends nothing when the shopper returns to the server's quantity before the delay ends", async () => {
    const line = harness(3);
    line.autosave.change(4);
    line.autosave.change(3);
    await vi.advanceTimersByTimeAsync(500);
    expect(line.sent).toEqual([]);
    expect(line.autosave.getState()).toEqual({ draft: null, pending: false, failure: null });
  });

  it("flush saves a waiting change at once; dispose stops the timer", async () => {
    const line = harness(1);
    line.autosave.change(2);
    line.autosave.flush();
    expect(line.sent).toEqual([2]);
    await line.answer();
    line.autosave.change(5);
    line.autosave.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(line.sent).toEqual([2]);
  });

  it("returns the same state object while nothing changed (useSyncExternalStore)", () => {
    const line = harness(1);
    expect(line.autosave.getState()).toBe(line.autosave.getState());
  });
});
