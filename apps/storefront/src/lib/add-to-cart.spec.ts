import { describe, expect, it } from "vitest";
import { MAX_LINE_QUANTITY, addQuantityRefusal, lineRoom } from "./add-to-cart";

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
