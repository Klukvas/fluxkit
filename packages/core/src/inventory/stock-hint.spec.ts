import { describe, expect, it } from "vitest";
import { cartLineStockHint, decideReserve } from "./index.js";
import type { StockFlags, StockLevel } from "./index.js";

const tracked: StockFlags = { trackInventory: true, allowBackorder: false };
const level = (onHand: number, reserved = 0): StockLevel => ({ onHand, reserved });

describe("cartLineStockHint (cart plan 2026-11-02: what the checkout would say, without a number above the threshold)", () => {
  it.each<
    [string, StockLevel | null, number, { insufficientStock: boolean; maxQuantity: number | null }]
  >([
    ["enough stock", level(22), 3, { insufficientStock: false, maxQuantity: null }],
    ["exactly enough", level(22), 22, { insufficientStock: false, maxQuantity: null }],
    [
      "one too many, above the threshold: no number",
      level(22),
      23,
      { insufficientStock: true, maxQuantity: null },
    ],
    ["999 of 22: no number", level(22), 999, { insufficientStock: true, maxQuantity: null }],
    ["8 of 3: the low number", level(3), 8, { insufficientStock: true, maxQuantity: 3 }],
    ["at the threshold", level(5), 6, { insufficientStock: true, maxQuantity: 5 }],
    ["one above the threshold", level(6), 7, { insufficientStock: true, maxQuantity: null }],
    ["stock 0", level(0), 1, { insufficientStock: true, maxQuantity: 0 }],
    ["no level row", null, 1, { insufficientStock: true, maxQuantity: 0 }],
    ["reserved stock lowers it", level(10, 8), 3, { insufficientStock: true, maxQuantity: 2 }],
    [
      "reserved stock leaves enough",
      level(10, 8),
      2,
      { insufficientStock: false, maxQuantity: null },
    ],
    [
      "reserved above on hand (backorder history)",
      level(2, 5),
      1,
      { insufficientStock: true, maxQuantity: 0 },
    ],
  ])("%s", (_name, stock, quantity, expected) => {
    expect(cartLineStockHint(tracked, stock, quantity, 5)).toEqual(expected);
  });

  it("backorder and untracked variants are never short", () => {
    expect(
      cartLineStockHint({ trackInventory: true, allowBackorder: true }, level(0), 999, 5),
    ).toEqual({ insufficientStock: false, maxQuantity: null });
    expect(
      cartLineStockHint({ trackInventory: false, allowBackorder: false }, null, 999, 5),
    ).toEqual({ insufficientStock: false, maxQuantity: null });
  });

  it("threshold 0 gives a number only for nothing left", () => {
    expect(cartLineStockHint(tracked, level(1), 2, 0)).toEqual({
      insufficientStock: true,
      maxQuantity: null,
    });
    expect(cartLineStockHint(tracked, level(0), 2, 0)).toEqual({
      insufficientStock: true,
      maxQuantity: 0,
    });
  });

  it("agrees with decideReserve (the checkout's rule) on every small case", () => {
    for (const trackInventory of [true, false]) {
      for (const allowBackorder of [true, false]) {
        for (let onHand = 0; onHand <= 6; onHand++) {
          for (let reserved = 0; reserved <= 6; reserved++) {
            for (let quantity = 1; quantity <= 8; quantity++) {
              const flags = { trackInventory, allowBackorder };
              const decision = decideReserve(level(onHand, reserved), flags, quantity);
              const hint = cartLineStockHint(flags, level(onHand, reserved), quantity, 5);
              expect(hint.insufficientStock).toBe(
                !decision.ok && decision.reason === "insufficient_stock",
              );
            }
          }
        }
      }
    }
  });

  it("throws on corrupt data and bad input like the inventory rules do", () => {
    expect(() => cartLineStockHint(tracked, level(-1), 1, 5)).toThrow(RangeError);
    expect(() => cartLineStockHint(tracked, level(1), 0, 5)).toThrow(RangeError);
    expect(() => cartLineStockHint(tracked, level(1), 1.5, 5)).toThrow(RangeError);
    expect(() => cartLineStockHint(tracked, level(1), 1, -1)).toThrow(RangeError);
  });
});
