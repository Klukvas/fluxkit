import { describe, expect, it } from "vitest";
import { invoiceValidity } from "./validity.js";
import { MINUTE, plusMs } from "./test-support.js";

const now = new Date("2026-10-26T10:00:00.000Z");

describe("invoiceValidity (ADR 0032 decision 9, open question 3)", () => {
  it("ends 3 minutes before the order deadline; validity in whole seconds", () => {
    const orderExpiresAt = plusMs(now, 30 * MINUTE);
    expect(invoiceValidity({ now, orderExpiresAt })).toEqual({
      ok: true,
      expiresAt: plusMs(now, 27 * MINUTE),
      validitySeconds: 27 * 60,
    });
  });

  it("allows exactly 5 minutes of validity and refuses 1 ms less", () => {
    expect(invoiceValidity({ now, orderExpiresAt: plusMs(now, 8 * MINUTE) })).toEqual({
      ok: true,
      expiresAt: plusMs(now, 5 * MINUTE),
      validitySeconds: 300,
    });
    expect(invoiceValidity({ now, orderExpiresAt: plusMs(now, 8 * MINUTE - 1) })).toEqual({
      ok: false,
      reason: "payment_window_too_short",
    });
  });

  it("measures the 5 minutes against the invoice, not the order: an order with 7 minutes left is refused", () => {
    expect(invoiceValidity({ now, orderExpiresAt: plusMs(now, 7 * MINUTE) }).ok).toBe(false);
    // The shortest order TTL (5 minutes) is never payable online.
    expect(invoiceValidity({ now, orderExpiresAt: plusMs(now, 5 * MINUTE) }).ok).toBe(false);
  });

  it("rounds the provider validity down to whole seconds, never past our expiry", () => {
    const result = invoiceValidity({ now, orderExpiresAt: plusMs(now, 8 * MINUTE + 999) });
    expect(result).toEqual({
      ok: true,
      expiresAt: plusMs(now, 5 * MINUTE + 999),
      validitySeconds: 300,
    });
  });

  it("refuses an order already past its deadline", () => {
    expect(invoiceValidity({ now, orderExpiresAt: now }).ok).toBe(false);
    expect(invoiceValidity({ now, orderExpiresAt: plusMs(now, -MINUTE) }).ok).toBe(false);
  });

  it("throws on an invalid date", () => {
    expect(() => invoiceValidity({ now: new Date("x"), orderExpiresAt: now })).toThrow(RangeError);
    expect(() => invoiceValidity({ now, orderExpiresAt: "2026" as unknown as Date })).toThrow(
      RangeError,
    );
  });
});
