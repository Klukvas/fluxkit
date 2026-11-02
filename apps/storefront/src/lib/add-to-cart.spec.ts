import { describe, expect, it } from "vitest";
import {
  MAX_LINE_QUANTITY,
  addQuantityRefusal,
  addRoom,
  lineRoom,
  quantityLimitRefusal,
} from "./add-to-cart";

describe("addRoom (the cart line's stock hint, plan 2026-11-03)", () => {
  const line = (
    quantity: number,
    insufficientStock = false,
    maxQuantity: number | null = null,
  ) => ({
    quantity,
    insufficientStock,
    maxQuantity,
  });

  it("is the line limit without a line or without a stock hint", () => {
    expect(addRoom(undefined)).toEqual({ inCart: 0, room: MAX_LINE_QUANTITY, stock: null });
    expect(addRoom(line(990))).toEqual({ inCart: 990, room: 9, stock: null });
  });

  it("allows nothing more when the cart already holds more than the shop has (with or without a count)", () => {
    expect(addRoom(line(8, true, 3))).toEqual({ inCart: 8, room: 0, stock: { available: 3 } });
    expect(addRoom(line(999, true, null))).toEqual({
      inCart: 999,
      room: 0,
      stock: { available: null },
    });
  });

  it("never offers more than the count the API gave, minus the cart's quantity", () => {
    // Not a state the API answers today (a count only comes with the flag, below the line's quantity); the cap holds anyway.
    expect(addRoom(line(1, true, 4)).room).toBe(3);
  });
});

describe("lineRoom", () => {
  it("is what one more add may still put on the line", () => {
    expect(lineRoom(0)).toBe(MAX_LINE_QUANTITY);
    expect(lineRoom(990)).toBe(9);
    expect(lineRoom(999)).toBe(0);
    expect(lineRoom(1200)).toBe(0);
  });
});

describe("addQuantityRefusal (review SQ-02: the limit message names what is already in the cart)", () => {
  it("lets an add through when the line has room for it", () => {
    expect(addQuantityRefusal(1, 0)).toBeNull();
    expect(addQuantityRefusal(9, 990)).toBeNull();
    expect(addQuantityRefusal(999, 0)).toBeNull();
  });

  it("refuses 1 more on a line of 999 with the cart's quantity, not the bare limit", () => {
    expect(addQuantityRefusal(1, 999)).toEqual({
      messageKey: "product.quantity.atLimit",
      values: { count: 999, max: MAX_LINE_QUANTITY, room: 0 },
    });
  });

  it("refuses more than the room left and says how many can still be added", () => {
    expect(addQuantityRefusal(10, 990)).toEqual({
      messageKey: "product.quantity.overLimit",
      values: { count: 990, max: MAX_LINE_QUANTITY, room: 9 },
    });
  });
});

describe("quantityLimitRefusal (PR 213 review m1: never word a stale cart quantity as fact)", () => {
  it("keeps the API's text when the cart was not read again", () => {
    expect(quantityLimitRefusal(1, undefined)).toBeNull();
  });

  it("names the quantity read again after the refusal (another tab raised the line to 999)", () => {
    expect(quantityLimitRefusal(1, 999)).toEqual({
      messageKey: "product.quantity.atLimit",
      values: { count: 999, max: MAX_LINE_QUANTITY, room: 0 },
    });
  });

  it("says nothing the fresh cart contradicts (the add would fit now)", () => {
    expect(quantityLimitRefusal(1, 5)).toBeNull();
  });
});
