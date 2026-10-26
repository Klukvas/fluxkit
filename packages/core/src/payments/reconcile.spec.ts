import { describe, expect, it } from "vitest";
import { nextPaymentCheck } from "./reconcile.js";
import { MINUTE, plusMs } from "./test-support.js";

const now = new Date("2026-10-26T10:00:00.000Z");

describe("nextPaymentCheck (ADR 0032 decision 13: 1, 2, 5, 10, 30 minutes, then hourly for 48 hours)", () => {
  it("follows the schedule after each check", () => {
    const expected = [1, 2, 5, 10, 30];
    expected.forEach((minutes, index) => {
      expect(nextPaymentCheck({ checks: index + 1, now }), String(index + 1)).toEqual({
        action: "check",
        at: plusMs(now, minutes * MINUTE),
      });
    });
  });

  it("then checks hourly 48 times, then gives up (reconcile_gave_up)", () => {
    expect(nextPaymentCheck({ checks: 6, now })).toEqual({
      action: "check",
      at: plusMs(now, 60 * MINUTE),
    });
    expect(nextPaymentCheck({ checks: 5 + 48, now })).toEqual({
      action: "check",
      at: plusMs(now, 60 * MINUTE),
    });
    expect(nextPaymentCheck({ checks: 5 + 48 + 1, now })).toEqual({
      action: "give_up",
      attentionCode: "reconcile_gave_up",
    });
  });

  it("the first check (none made yet) is due now", () => {
    expect(nextPaymentCheck({ checks: 0, now })).toEqual({ action: "check", at: now });
  });

  it("throws on a negative or fractional count or an invalid date", () => {
    expect(() => nextPaymentCheck({ checks: -1, now })).toThrow(RangeError);
    expect(() => nextPaymentCheck({ checks: 1.5, now })).toThrow(RangeError);
    expect(() => nextPaymentCheck({ checks: 1, now: new Date("x") })).toThrow(RangeError);
  });
});
