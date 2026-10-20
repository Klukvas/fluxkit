import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEARCH_DEBOUNCE_MS, createDebounce } from "./debounce";

describe("createDebounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs only the last scheduled call, after the pause (300 ms for searches)", () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(300);
    const calls: string[] = [];
    const debounce = createDebounce(SEARCH_DEBOUNCE_MS);
    debounce.schedule(() => calls.push("a"));
    vi.advanceTimersByTime(299);
    debounce.schedule(() => calls.push("ab"));
    vi.advanceTimersByTime(299);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(["ab"]);
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual(["ab"]);
  });

  it("cancels a pending call (an invalid text, a submit that applies at once, unmount)", () => {
    const calls: string[] = [];
    const debounce = createDebounce(300);
    debounce.schedule(() => calls.push("x"));
    debounce.cancel();
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual([]);
    debounce.cancel();
  });
});
