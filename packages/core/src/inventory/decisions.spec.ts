import { describe, expect, it } from "vitest";
import { deepFreeze } from "../catalog/test-support.js";
import { MAX_QUANTITY } from "../pricing/limits.js";
import {
  decideAdjustment,
  decideCommit,
  decideExpire,
  decideExtend,
  decideRelease,
  decideReserve,
} from "./decisions.js";
import { MAX_ON_HAND, MAX_RESERVED } from "./limits.js";
import type { ReservationStatus } from "./types.js";

const tracked = { trackInventory: true, allowBackorder: false } as const;
const backorder = { trackInventory: true, allowBackorder: true } as const;
const level = (onHand: number, reserved: number) => deepFreeze({ onHand, reserved });

describe("decideReserve", () => {
  it("raises reserved and records a new active reservation, no journal row", () => {
    expect(decideReserve(level(10, 2), tracked, 3)).toEqual({
      ok: true,
      level: { onHand: 10, reserved: 5 },
      movement: null,
      reservationStatus: "active",
    });
  });

  it("allows reserving exactly the available quantity", () => {
    const result = decideReserve(level(10, 4), tracked, 6);
    expect(result).toMatchObject({ ok: true, level: { onHand: 10, reserved: 10 } });
  });

  it("refuses more than available", () => {
    expect(decideReserve(level(10, 4), tracked, 7)).toEqual({
      ok: false,
      reason: "insufficient_stock",
    });
    expect(decideReserve(level(0, 0), tracked, 1)).toEqual({
      ok: false,
      reason: "insufficient_stock",
    });
  });

  it("refuses when reserved already exceeds on hand (after a backorder flag change)", () => {
    expect(decideReserve(level(2, 5), tracked, 1)).toEqual({
      ok: false,
      reason: "insufficient_stock",
    });
  });

  it("with backorder allowed reserved may exceed on hand", () => {
    expect(decideReserve(level(1, 1), backorder, 4)).toMatchObject({
      ok: true,
      level: { onHand: 1, reserved: 5 },
    });
  });

  it("refuses a reserved total above the stored limit, also with backorder (R5)", () => {
    expect(decideReserve(level(0, 2_147_000_000), backorder, 1_000_000)).toEqual({
      ok: false,
      reason: "reserved_out_of_range",
    });
    expect(decideReserve(level(0, MAX_RESERVED - 1), backorder, 1)).toMatchObject({
      ok: true,
      level: { onHand: 0, reserved: MAX_RESERVED },
    });
    expect(decideReserve(level(0, MAX_RESERVED), backorder, 1)).toEqual({
      ok: false,
      reason: "reserved_out_of_range",
    });
  });

  it("refuses an untracked variant: there is no stock to hold", () => {
    expect(decideReserve(level(5, 0), { trackInventory: false, allowBackorder: false }, 1)).toEqual(
      { ok: false, reason: "not_tracked" },
    );
  });

  it("refuses invalid quantities", () => {
    for (const quantity of [
      0,
      -1,
      1.5,
      Number.NaN,
      MAX_QUANTITY + 1,
      "1" as never,
      null as never,
    ]) {
      expect(decideReserve(level(10, 0), tracked, quantity)).toEqual({
        ok: false,
        reason: "invalid_quantity",
      });
    }
    expect(decideReserve(level(MAX_QUANTITY, 0), tracked, MAX_QUANTITY).ok).toBe(true);
  });

  it("throws RangeError for a corrupt level", () => {
    expect(() => decideReserve({ onHand: -1, reserved: 0 }, tracked, 1)).toThrow(RangeError);
  });
});

describe("decideRelease and decideExpire", () => {
  it("release lowers reserved only and marks the reservation released", () => {
    expect(decideRelease(level(10, 5), { quantity: 3, status: "active" })).toEqual({
      ok: true,
      level: { onHand: 10, reserved: 2 },
      movement: null,
      reservationStatus: "released",
    });
  });

  it("expire lowers reserved only and marks the reservation expired", () => {
    expect(decideExpire(level(10, 5), { quantity: 5, status: "active" })).toEqual({
      ok: true,
      level: { onHand: 10, reserved: 0 },
      movement: null,
      reservationStatus: "expired",
    });
  });

  it("only an active reservation can be released or expired", () => {
    for (const status of ["released", "expired"] as const) {
      expect(decideRelease(level(10, 5), { quantity: 1, status })).toEqual({
        ok: false,
        reason: "not_active",
      });
      expect(decideExpire(level(10, 5), { quantity: 1, status })).toEqual({
        ok: false,
        reason: "not_active",
      });
    }
    expect(decideRelease(level(10, 5), { quantity: 1, status: "committed" })).toEqual({
      ok: false,
      reason: "already_committed",
    });
    expect(decideExpire(level(10, 5), { quantity: 1, status: "committed" })).toEqual({
      ok: false,
      reason: "already_committed",
    });
  });

  it("refuses when the level cannot hold the reservation (reserved below its quantity)", () => {
    expect(decideRelease(level(10, 1), { quantity: 3, status: "active" })).toEqual({
      ok: false,
      reason: "level_inconsistent",
    });
    expect(decideExpire(level(10, 1), { quantity: 3, status: "active" })).toEqual({
      ok: false,
      reason: "level_inconsistent",
    });
  });

  it("refuses an invalid reservation quantity and throws for an unknown status", () => {
    expect(decideRelease(level(10, 5), { quantity: 0, status: "active" })).toEqual({
      ok: false,
      reason: "invalid_quantity",
    });
    expect(() => decideRelease(level(10, 5), { quantity: 1, status: "bogus" as never })).toThrow(
      RangeError,
    );
  });
});

describe("decideCommit", () => {
  it("lowers on hand and reserved by the quantity and records a negative sale movement", () => {
    expect(decideCommit(level(10, 4), { quantity: 3, status: "active" })).toEqual({
      ok: true,
      level: { onHand: 7, reserved: 1 },
      movement: { kind: "sale", delta: -3, onHandAfter: 7 },
      reservationStatus: "committed",
    });
  });

  it("refuses a committed reservation as already_committed, others as not_active", () => {
    expect(decideCommit(level(10, 4), { quantity: 3, status: "committed" })).toEqual({
      ok: false,
      reason: "already_committed",
    });
    for (const status of ["released", "expired"] as const) {
      expect(decideCommit(level(10, 4), { quantity: 3, status })).toEqual({
        ok: false,
        reason: "not_active",
      });
    }
  });

  it("refuses to sell more than is on hand (backorder reservations cannot be shipped yet)", () => {
    expect(decideCommit(level(1, 4), { quantity: 3, status: "active" })).toEqual({
      ok: false,
      reason: "insufficient_stock",
    });
  });

  it("refuses when reserved is below the quantity", () => {
    expect(decideCommit(level(10, 1), { quantity: 3, status: "active" })).toEqual({
      ok: false,
      reason: "level_inconsistent",
    });
  });

  it("refuses an invalid quantity", () => {
    expect(decideCommit(level(10, 4), { quantity: 1.5, status: "active" })).toEqual({
      ok: false,
      reason: "invalid_quantity",
    });
  });
});

describe("decideAdjustment", () => {
  it("applies a delta and records the movement with on_hand_after", () => {
    expect(decideAdjustment(level(5, 2), { mode: "delta", delta: 10, kind: "receipt" })).toEqual({
      ok: true,
      level: { onHand: 15, reserved: 2 },
      movement: { kind: "receipt", delta: 10, onHandAfter: 15 },
    });
    expect(decideAdjustment(level(5, 2), { mode: "delta", delta: -3, kind: "adjustment" })).toEqual(
      {
        ok: true,
        level: { onHand: 2, reserved: 2 },
        movement: { kind: "adjustment", delta: -3, onHandAfter: 2 },
      },
    );
  });

  it("sets on hand and records the difference as the delta", () => {
    expect(
      decideAdjustment(level(5, 0), { mode: "setOnHand", onHand: 12, kind: "adjustment" }),
    ).toEqual({
      ok: true,
      level: { onHand: 12, reserved: 0 },
      movement: { kind: "adjustment", delta: 7, onHandAfter: 12 },
    });
    expect(
      decideAdjustment(level(5, 0), { mode: "setOnHand", onHand: 0, kind: "adjustment" }),
    ).toMatchObject({ ok: true, movement: { delta: -5, onHandAfter: 0 } });
  });

  it("refuses a result below zero", () => {
    expect(decideAdjustment(level(2, 0), { mode: "delta", delta: -3, kind: "adjustment" })).toEqual(
      { ok: false, reason: "negative_on_hand" },
    );
    expect(
      decideAdjustment(level(2, 0), { mode: "setOnHand", onHand: -1, kind: "adjustment" }),
    ).toEqual({ ok: false, reason: "negative_on_hand" });
  });

  it("refuses a change that lowers on hand below reserved", () => {
    expect(
      decideAdjustment(level(10, 6), { mode: "delta", delta: -5, kind: "adjustment" }),
    ).toEqual({ ok: false, reason: "below_reserved" });
    expect(
      decideAdjustment(level(10, 6), { mode: "setOnHand", onHand: 5, kind: "adjustment" }),
    ).toEqual({ ok: false, reason: "below_reserved" });
    expect(
      decideAdjustment(level(10, 6), { mode: "delta", delta: -4, kind: "adjustment" }).ok,
    ).toBe(true);
    // Already backordered: lowering on hand further is still refused.
    expect(
      decideAdjustment(level(3, 10), { mode: "delta", delta: -1, kind: "adjustment" }),
    ).toEqual({ ok: false, reason: "below_reserved" });
    expect(
      decideAdjustment(level(3, 10), { mode: "setOnHand", onHand: 2, kind: "adjustment" }),
    ).toEqual({ ok: false, reason: "below_reserved" });
  });

  it("allows a change that raises on hand even while the result stays below reserved (R1)", () => {
    expect(decideAdjustment(level(0, 10), { mode: "delta", delta: 5, kind: "receipt" })).toEqual({
      ok: true,
      level: { onHand: 5, reserved: 10 },
      movement: { kind: "receipt", delta: 5, onHandAfter: 5 },
    });
    expect(
      decideAdjustment(level(2, 10), { mode: "setOnHand", onHand: 4, kind: "adjustment" }).ok,
    ).toBe(true);
    expect(decideAdjustment(level(0, 10), { mode: "delta", delta: 1, kind: "return" }).ok).toBe(
      true,
    );
  });

  it("refuses a change of zero (the journal never holds a zero delta)", () => {
    expect(decideAdjustment(level(5, 0), { mode: "delta", delta: 0, kind: "adjustment" })).toEqual({
      ok: false,
      reason: "no_change",
    });
    expect(
      decideAdjustment(level(5, 0), { mode: "setOnHand", onHand: 5, kind: "adjustment" }),
    ).toEqual({ ok: false, reason: "no_change" });
  });

  it("refuses non-integer numbers", () => {
    for (const delta of [1.5, Number.NaN, Number.POSITIVE_INFINITY, "1" as never]) {
      expect(decideAdjustment(level(5, 0), { mode: "delta", delta, kind: "adjustment" })).toEqual({
        ok: false,
        reason: "invalid_quantity",
      });
    }
    expect(
      decideAdjustment(level(5, 0), { mode: "setOnHand", onHand: 1.5, kind: "adjustment" }),
    ).toEqual({ ok: false, reason: "invalid_quantity" });
  });

  it("refuses a result above the on-hand limit", () => {
    expect(
      decideAdjustment(level(MAX_ON_HAND, 0), { mode: "delta", delta: 1, kind: "receipt" }),
    ).toEqual({ ok: false, reason: "on_hand_out_of_range" });
    expect(
      decideAdjustment(level(0, 0), { mode: "setOnHand", onHand: MAX_ON_HAND, kind: "receipt" }).ok,
    ).toBe(true);
  });

  it("receipts and returns must add stock", () => {
    for (const kind of ["receipt", "return"] as const) {
      expect(decideAdjustment(level(5, 0), { mode: "delta", delta: -1, kind })).toEqual({
        ok: false,
        reason: "kind_requires_increase",
      });
    }
    expect(decideAdjustment(level(5, 0), { mode: "delta", delta: 1, kind: "return" }).ok).toBe(
      true,
    );
  });

  it("throws RangeError for a kind that can not be adjusted (sales go through commit)", () => {
    expect(() =>
      decideAdjustment(level(5, 0), { mode: "delta", delta: 1, kind: "sale" as never }),
    ).toThrow(RangeError);
    expect(() =>
      decideAdjustment(level(5, 0), { mode: "other", delta: 1, kind: "adjustment" } as never),
    ).toThrow(RangeError);
  });

  it("works for untracked variants (stock can be recorded before tracking is switched on)", () => {
    expect(decideAdjustment(level(0, 0), { mode: "delta", delta: 4, kind: "receipt" }).ok).toBe(
      true,
    );
  });
});

describe("backorder fulfilment flow (R1)", () => {
  it("reserves beyond stock, takes partial receipts and commits reservation by reservation", () => {
    let current = { onHand: 0, reserved: 0 };
    for (const quantity of [4, 4, 2]) {
      const reserved = decideReserve(current, backorder, quantity);
      if (!reserved.ok) {
        throw new Error("reserve refused");
      }
      current = reserved.level;
    }
    expect(current).toEqual({ onHand: 0, reserved: 10 });
    const active = (quantity: number) => ({ quantity, status: "active" as const });

    const receive = (delta: number) => {
      const result = decideAdjustment(current, { mode: "delta", delta, kind: "receipt" });
      if (!result.ok) {
        throw new Error(`receipt refused: ${result.reason}`);
      }
      current = result.level;
    };
    const commit = (quantity: number) => {
      const result = decideCommit(current, active(quantity));
      if (!result.ok) {
        return result.reason;
      }
      current = result.level;
      return "committed";
    };

    expect(commit(4)).toBe("insufficient_stock");
    receive(3);
    expect(current).toEqual({ onHand: 3, reserved: 10 });
    expect(commit(4)).toBe("insufficient_stock");
    receive(2);
    expect(commit(4)).toBe("committed");
    expect(current).toEqual({ onHand: 1, reserved: 6 });
    expect(commit(4)).toBe("insufficient_stock");
    receive(5);
    expect(commit(4)).toBe("committed");
    expect(commit(2)).toBe("committed");
    expect(current).toEqual({ onHand: 0, reserved: 0 });
  });
});

describe("decideExtend", () => {
  const current = new Date("2026-10-17T12:40:00.000Z");
  const later = new Date("2026-10-18T12:40:00.000Z");
  const reservation = (status: ReservationStatus) => deepFreeze({ status, expiresAt: current });

  it("moves the expiry of an active reservation to a later time", () => {
    expect(decideExtend(reservation("active"), later)).toEqual({ ok: true, expiresAt: later });
    expect(decideExtend(reservation("active"), new Date(current.getTime() + 1))).toMatchObject({
      ok: true,
    });
  });

  it("accepts the same time again (a retry) but never an earlier one", () => {
    expect(decideExtend(reservation("active"), new Date(current.getTime()))).toEqual({
      ok: true,
      expiresAt: current,
    });
    expect(decideExtend(reservation("active"), new Date(current.getTime() - 1))).toEqual({
      ok: false,
      reason: "would_shorten",
    });
    expect(decideExtend(reservation("active"), new Date(0))).toEqual({
      ok: false,
      reason: "would_shorten",
    });
  });

  it("refuses a reservation that is not active, with the same reasons as release and commit", () => {
    expect(decideExtend(reservation("committed"), later)).toEqual({
      ok: false,
      reason: "already_committed",
    });
    expect(decideExtend(reservation("released"), later)).toEqual({
      ok: false,
      reason: "not_active",
    });
    expect(decideExtend(reservation("expired"), later)).toEqual({
      ok: false,
      reason: "not_active",
    });
  });

  it("checks the status before the new time", () => {
    expect(decideExtend(reservation("released"), new Date(Number.NaN))).toEqual({
      ok: false,
      reason: "not_active",
    });
    expect(decideExtend(reservation("committed"), new Date(0))).toEqual({
      ok: false,
      reason: "already_committed",
    });
  });

  it("refuses a new expiry that is not a valid Date (invalid_expiry)", () => {
    for (const value of [new Date(Number.NaN), "2027-01-01", 1_800_000_000_000, null, undefined]) {
      expect(decideExtend(reservation("active"), value as Date), String(value)).toEqual({
        ok: false,
        reason: "invalid_expiry",
      });
    }
  });

  it("returns a new Date, so the caller can not change the result through its input", () => {
    const input = new Date(later.getTime());
    const result = decideExtend(reservation("active"), input);
    if (!result.ok) throw new Error("expected ok");
    expect(result.expiresAt).not.toBe(input);
    input.setTime(0);
    expect(result.expiresAt.getTime()).toBe(later.getTime());
  });

  it("does not change its input", () => {
    const stored = deepFreeze({
      status: "active" as const,
      expiresAt: new Date(current.getTime()),
    });
    const target = new Date(later.getTime());
    decideExtend(stored, target);
    expect(stored.expiresAt.getTime()).toBe(current.getTime());
    expect(target.getTime()).toBe(later.getTime());
  });

  it("treats corrupt stored data as a bug (RangeError): unknown status, invalid stored expiry", () => {
    expect(() =>
      decideExtend({ status: "pending" as ReservationStatus, expiresAt: current }, later),
    ).toThrow(RangeError);
    expect(() =>
      decideExtend({ status: "active", expiresAt: new Date(Number.NaN) }, later),
    ).toThrow(RangeError);
    expect(() =>
      decideExtend({ status: "active", expiresAt: "2026-10-17" as unknown as Date }, later),
    ).toThrow(RangeError);
  });

  it("decides the expiry only: the result carries no level and no journal row", () => {
    expect(Object.keys(decideExtend(reservation("active"), later)).sort()).toEqual([
      "expiresAt",
      "ok",
    ]);
  });
});
