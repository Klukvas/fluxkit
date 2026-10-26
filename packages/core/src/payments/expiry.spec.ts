import { describe, expect, it } from "vitest";
import { decideExpiry, type ExpiryAttempt } from "./expiry.js";
import type { PaymentStatus } from "./status.js";
import { MINUTE, OTHER_PAYMENT_ID, PAYMENT_ID, plusMs } from "./test-support.js";

const placedAt = new Date("2026-10-26T10:00:00.000Z");
const ttlMinutes = 30;
/** The normal deadline (placed + TTL) and the cap (30 minutes later). */
const N = plusMs(placedAt, 30 * MINUTE);
const CAP = plusMs(N, 30 * MINUTE);

const attempt = (status: PaymentStatus, id = PAYMENT_ID): ExpiryAttempt => ({ id, status });

function decide(now: Date, orderExpiresAt: Date, attempts: ExpiryAttempt[]) {
  return decideExpiry({ now, orderExpiresAt, placedAt, ttlMinutes, attempts });
}

describe("decideExpiry (ADR 0032 decision 8)", () => {
  it("is not due before the deadline (1 ms before), due exactly at it", () => {
    expect(decide(plusMs(N, -1), N, [])).toEqual({ action: "not_due" });
    expect(decide(N, N, [])).toEqual({ action: "expire", capReached: false });
    expect(decide(plusMs(N, 1), N, [])).toEqual({ action: "expire", capReached: false });
  });

  it("expires when no attempt is live", () => {
    for (const status of ["succeeded", "failed", "expired", "invalidated"] as const) {
      expect(decide(N, N, [attempt(status)]), status).toEqual({
        action: "expire",
        capReached: false,
      });
    }
  });

  it("defers by 10 minutes while an attempt is live (processing or unconfirmed)", () => {
    for (const status of [
      "processing",
      "awaiting_customer",
      "create_unknown",
      "creating",
    ] as const) {
      expect(decide(N, N, [attempt("failed", OTHER_PAYMENT_ID), attempt(status)]), status).toEqual({
        action: "defer",
        expiresAt: plusMs(N, 10 * MINUTE),
        attemptIdsToCheck: [PAYMENT_ID],
      });
    }
    // 1 ms after the deadline: still the regular step from the deadline.
    expect(decide(plusMs(N, 1), N, [attempt("processing")])).toMatchObject({
      action: "defer",
      expiresAt: plusMs(N, 10 * MINUTE),
    });
  });

  it("steps from now when the job runs later than one step", () => {
    const now = plusMs(N, 12 * MINUTE);
    expect(decide(now, N, [attempt("processing")])).toMatchObject({
      action: "defer",
      expiresAt: plusMs(now, 10 * MINUTE),
    });
  });

  it("defers in steps up to exactly 30 minutes past the normal deadline, then expires anyway", () => {
    const step1 = plusMs(N, 10 * MINUTE);
    const step2 = plusMs(N, 20 * MINUTE);
    expect(decide(step1, step1, [attempt("processing")])).toMatchObject({ expiresAt: step2 });
    expect(decide(step2, step2, [attempt("processing")])).toMatchObject({ expiresAt: CAP });
    expect(decide(CAP, CAP, [attempt("processing")])).toEqual({
      action: "expire",
      capReached: true,
    });
  });

  it("caps a step that would pass the cap at the cap exactly", () => {
    const odd = plusMs(N, 25 * MINUTE);
    expect(decide(odd, odd, [attempt("awaiting_customer")])).toEqual({
      action: "defer",
      expiresAt: CAP,
      attemptIdsToCheck: [PAYMENT_ID],
    });
    expect(decide(plusMs(CAP, -1), plusMs(CAP, -1), [attempt("processing")])).toMatchObject({
      action: "defer",
      expiresAt: CAP,
    });
    expect(decide(plusMs(CAP, 1), N, [attempt("processing")])).toEqual({
      action: "expire",
      capReached: true,
    });
  });

  it("never shortens the deadline", () => {
    const later = plusMs(CAP, 5 * MINUTE);
    expect(decide(later, later, [attempt("processing")])).toEqual({
      action: "expire",
      capReached: true,
    });
  });

  it("throws on bad input (invalid dates, TTL out of range, unknown status)", () => {
    expect(() => decide(new Date("x"), N, [])).toThrow(RangeError);
    expect(() =>
      decideExpiry({ now: N, orderExpiresAt: N, placedAt, ttlMinutes: 4, attempts: [] }),
    ).toThrow(RangeError);
    expect(() => decide(N, N, [attempt("paid" as PaymentStatus)])).toThrow(RangeError);
  });
});
