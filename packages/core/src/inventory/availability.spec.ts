import { describe, expect, it } from "vitest";
import { deepFreeze } from "../catalog/test-support.js";
import { availabilityOf } from "./availability.js";

const tracked = { trackInventory: true, allowBackorder: false } as const;

describe("availabilityOf", () => {
  it("is out_of_stock without levels or with nothing available", () => {
    expect(availabilityOf(tracked, [], 5)).toBe("out_of_stock");
    expect(availabilityOf(tracked, [{ onHand: 0, reserved: 0 }], 5)).toBe("out_of_stock");
    expect(availabilityOf(tracked, [{ onHand: 3, reserved: 3 }], 5)).toBe("out_of_stock");
  });

  it("is low_stock from 1 up to and including the threshold", () => {
    expect(availabilityOf(tracked, [{ onHand: 1, reserved: 0 }], 5)).toBe("low_stock");
    expect(availabilityOf(tracked, [{ onHand: 5, reserved: 0 }], 5)).toBe("low_stock");
    expect(availabilityOf(tracked, [{ onHand: 9, reserved: 4 }], 5)).toBe("low_stock");
  });

  it("is in_stock above the threshold", () => {
    expect(availabilityOf(tracked, [{ onHand: 6, reserved: 0 }], 5)).toBe("in_stock");
  });

  it("with threshold 0 there is no low_stock", () => {
    expect(availabilityOf(tracked, [{ onHand: 1, reserved: 0 }], 0)).toBe("in_stock");
    expect(availabilityOf(tracked, [{ onHand: 0, reserved: 0 }], 0)).toBe("out_of_stock");
  });

  it("sums available quantities over levels and clamps each level at 0", () => {
    const levels = deepFreeze([
      { onHand: 2, reserved: 0 },
      { onHand: 1, reserved: 5 },
      { onHand: 4, reserved: 1 },
    ]);
    expect(availabilityOf(tracked, levels, 5)).toBe("low_stock");
    expect(availabilityOf(tracked, levels, 4)).toBe("in_stock");
  });

  it("is in_stock when inventory is not tracked, whatever the levels", () => {
    const flags = { trackInventory: false, allowBackorder: false };
    expect(availabilityOf(flags, [], 5)).toBe("in_stock");
    expect(availabilityOf(flags, [{ onHand: 0, reserved: 0 }], 5)).toBe("in_stock");
  });

  it("is in_stock when backorder is allowed", () => {
    const flags = { trackInventory: true, allowBackorder: true };
    expect(availabilityOf(flags, [{ onHand: 0, reserved: 0 }], 5)).toBe("in_stock");
    expect(availabilityOf(flags, [{ onHand: 1, reserved: 9 }], 5)).toBe("in_stock");
  });

  it("throws RangeError for a bad threshold, even when the flags make it irrelevant", () => {
    for (const threshold of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "5" as never]) {
      expect(() => availabilityOf(tracked, [], threshold)).toThrow(RangeError);
      expect(() => availabilityOf({ ...tracked, trackInventory: false }, [], threshold)).toThrow(
        RangeError,
      );
    }
  });

  it("throws RangeError for corrupt level data or flags", () => {
    for (const level of [
      { onHand: -1, reserved: 0 },
      { onHand: 1, reserved: -1 },
      { onHand: 1.5, reserved: 0 },
      { onHand: Number.NaN, reserved: 0 },
      { onHand: "1", reserved: 0 },
    ]) {
      expect(() => availabilityOf(tracked, [level as never], 5)).toThrow(RangeError);
    }
    expect(() =>
      availabilityOf({ trackInventory: 1, allowBackorder: false } as never, [], 5),
    ).toThrow(RangeError);
  });
});
