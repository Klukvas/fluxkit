import { describe, expect, it } from "vitest";
import { JobBudget } from "./job-budget.js";

describe("JobBudget", () => {
  it("is exhausted exactly when the budget has elapsed on the monotonic clock", () => {
    let now = 1_000;
    const budget = new JobBudget(500, () => now);
    expect(budget.exhausted()).toBe(false);
    now = 1_499;
    expect(budget.exhausted()).toBe(false);
    now = 1_500;
    expect(budget.exhausted()).toBe(true);
    now = 9_000;
    expect(budget.exhausted()).toBe(true);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("refuses the budget %s", (ms) => {
    expect(() => new JobBudget(ms)).toThrow(RangeError);
  });

  it("is exhausted as soon as its signal is aborted, even with time remaining", () => {
    const controller = new AbortController();
    const budget = new JobBudget(500, () => 1_000, controller.signal);
    expect(budget.exhausted()).toBe(false);
    controller.abort();
    expect(budget.exhausted()).toBe(true);
    expect(new JobBudget(500, () => 1_000, controller.signal).exhausted()).toBe(true);
  });
});
