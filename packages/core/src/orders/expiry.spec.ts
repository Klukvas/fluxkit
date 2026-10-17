import { describe, expect, it } from "vitest";
import { deepFreeze } from "../catalog/test-support.js";
import {
  GUEST_ACCESS_DAYS,
  ORDER_PAYMENT_TTL_MINUTES,
  RESERVATION_GRACE_MINUTES,
  guestAccessExpiresAt,
  isGuestAccessValid,
  orderExpiresAt,
  reservationExpiresAt,
} from "./expiry.js";

const at = (iso: string): Date => new Date(iso);
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

describe("limits", () => {
  it("are the numbers of the plan", () => {
    expect(ORDER_PAYMENT_TTL_MINUTES).toEqual({ min: 5, max: 1440, default: 30 });
    expect(RESERVATION_GRACE_MINUTES).toBe(10);
    expect(GUEST_ACCESS_DAYS).toEqual({ min: 1, max: 3650, default: 90 });
    expect(Object.isFrozen(ORDER_PAYMENT_TTL_MINUTES)).toBe(true);
    expect(Object.isFrozen(GUEST_ACCESS_DAYS)).toBe(true);
  });
});

describe("orderExpiresAt", () => {
  it("adds the payment time to the placement time", () => {
    expect(orderExpiresAt(at("2026-10-17T12:00:00.000Z"), 30)).toEqual(
      at("2026-10-17T12:30:00.000Z"),
    );
    expect(orderExpiresAt(at("2026-10-17T23:50:00.500Z"), 30)).toEqual(
      at("2026-10-18T00:20:00.500Z"),
    );
  });

  it("is exact in milliseconds, also over a daylight saving change (UTC arithmetic)", () => {
    const placed = at("2026-03-29T00:30:00.000Z");
    expect(orderExpiresAt(placed, 1440).getTime() - placed.getTime()).toBe(DAY);
  });

  it("accepts 5 and 1440 minutes, refuses everything else (RangeError: it is configuration)", () => {
    const placed = at("2026-10-17T12:00:00.000Z");
    expect(orderExpiresAt(placed, 5).getTime() - placed.getTime()).toBe(5 * MINUTE);
    expect(orderExpiresAt(placed, 1440).getTime() - placed.getTime()).toBe(1440 * MINUTE);
    for (const ttl of [
      4,
      1441,
      0,
      -30,
      30.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "30",
      null,
      undefined,
    ]) {
      expect(() => orderExpiresAt(placed, ttl as number), String(ttl)).toThrow(RangeError);
    }
  });

  it("refuses a date that is not a valid Date", () => {
    for (const value of [
      new Date(Number.NaN),
      "2026-10-17",
      1_700_000_000_000,
      null,
      undefined,
      {},
    ]) {
      expect(() => orderExpiresAt(value as Date, 30)).toThrow(RangeError);
    }
  });

  it("refuses a result outside the range of dates instead of returning an invalid date", () => {
    expect(() => orderExpiresAt(new Date(8_640_000_000_000_000), 30)).toThrow(RangeError);
  });

  it("does not change its input and returns a new Date", () => {
    const placed = at("2026-10-17T12:00:00.000Z");
    const before = placed.getTime();
    const result = orderExpiresAt(placed, 30);
    expect(placed.getTime()).toBe(before);
    expect(result).not.toBe(placed);
  });
});

describe("reservationExpiresAt", () => {
  it("is the order expiry plus the grace period, so the order job always runs first", () => {
    const orderExpiry = at("2026-10-17T12:30:00.000Z");
    const reservation = reservationExpiresAt(orderExpiry);
    expect(reservation).toEqual(at("2026-10-17T12:40:00.000Z"));
    expect(reservation.getTime() - orderExpiry.getTime()).toBe(RESERVATION_GRACE_MINUTES * MINUTE);
    expect(reservation.getTime()).toBeGreaterThan(orderExpiry.getTime());
  });

  it("refuses an invalid date and an overflow, and does not change its input", () => {
    expect(() => reservationExpiresAt(new Date(Number.NaN))).toThrow(RangeError);
    expect(() => reservationExpiresAt("2026-10-17" as unknown as Date)).toThrow(RangeError);
    expect(() => reservationExpiresAt(new Date(8_640_000_000_000_000))).toThrow(RangeError);
    const orderExpiry = deepFreeze(at("2026-10-17T12:30:00.000Z"));
    reservationExpiresAt(orderExpiry);
    expect(orderExpiry.getTime()).toBe(at("2026-10-17T12:30:00.000Z").getTime());
  });
});

describe("guestAccessExpiresAt and isGuestAccessValid", () => {
  const created = at("2026-10-17T12:00:00.000Z");

  it("the access ends the given number of days after the order was created", () => {
    expect(guestAccessExpiresAt(created, 90)).toEqual(at("2027-01-15T12:00:00.000Z"));
    expect(guestAccessExpiresAt(created, 1).getTime() - created.getTime()).toBe(DAY);
    expect(guestAccessExpiresAt(created, 3650).getTime() - created.getTime()).toBe(3650 * DAY);
  });

  it("is valid until the expiry instant, which itself is already expired", () => {
    const expiry = guestAccessExpiresAt(created, 90);
    expect(isGuestAccessValid(created, created, 90)).toBe(true);
    expect(isGuestAccessValid(created, new Date(expiry.getTime() - 1), 90)).toBe(true);
    expect(isGuestAccessValid(created, expiry, 90)).toBe(false);
    expect(isGuestAccessValid(created, new Date(expiry.getTime() + 1), 90)).toBe(false);
    expect(isGuestAccessValid(created, at("2030-01-01T00:00:00.000Z"), 90)).toBe(false);
  });

  it("uses the configured number of days", () => {
    const now = new Date(created.getTime() + 2 * DAY);
    expect(isGuestAccessValid(created, now, 1)).toBe(false);
    expect(isGuestAccessValid(created, now, 3)).toBe(true);
  });

  it("is still valid when the clock is slightly behind the creation time (clock skew between servers)", () => {
    expect(isGuestAccessValid(created, new Date(created.getTime() - 5_000), 90)).toBe(true);
  });

  it("accepts 1 and 3650 days, refuses everything else and invalid dates (RangeError)", () => {
    for (const days of [0, 3651, -1, 1.5, Number.NaN, "90", null, undefined]) {
      expect(() => guestAccessExpiresAt(created, days as number), String(days)).toThrow(RangeError);
      expect(() => isGuestAccessValid(created, created, days as number), String(days)).toThrow(
        RangeError,
      );
    }
    expect(() => isGuestAccessValid(new Date(Number.NaN), created, 90)).toThrow(RangeError);
    expect(() => isGuestAccessValid(created, new Date(Number.NaN), 90)).toThrow(RangeError);
    expect(() => isGuestAccessValid(created, "now" as unknown as Date, 90)).toThrow(RangeError);
    expect(() => guestAccessExpiresAt(new Date(8_640_000_000_000_000), 90)).toThrow(RangeError);
  });

  it("does not change its inputs", () => {
    const first = new Date(created.getTime());
    const second = new Date(created.getTime() + DAY);
    isGuestAccessValid(first, second, 90);
    expect(first.getTime()).toBe(created.getTime());
    expect(second.getTime()).toBe(created.getTime() + DAY);
  });
});
