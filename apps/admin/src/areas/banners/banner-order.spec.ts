import { describe, expect, it } from "vitest";
import { moveBy, moveTo } from "./banner-order";

describe("reordering the banner list", () => {
  const ids = ["a", "b", "c", "d"] as const;

  it("moves one place up or down and leaves the input alone", () => {
    expect(moveBy(ids, 2, -1)).toEqual(["a", "c", "b", "d"]);
    expect(moveBy(ids, 1, 1)).toEqual(["a", "c", "b", "d"]);
    expect(ids).toEqual(["a", "b", "c", "d"]);
  });

  it("does nothing past either end or outside the list", () => {
    expect(moveBy(ids, 0, -1)).toBeNull();
    expect(moveBy(ids, 3, 1)).toBeNull();
    expect(moveBy(ids, 7, -1)).toBeNull();
    expect(moveBy(ids, -1, 1)).toBeNull();
    expect(moveBy([], 0, 1)).toBeNull();
  });

  it("drops a dragged row onto another row's place, both directions", () => {
    expect(moveTo(ids, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveTo(ids, 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveTo(ids, 1, 2)).toEqual(["a", "c", "b", "d"]);
  });

  it("sends nothing for a drop on itself or outside the list", () => {
    expect(moveTo(ids, 1, 1)).toBeNull();
    expect(moveTo(ids, 1, 4)).toBeNull();
    expect(moveTo(ids, -1, 0)).toBeNull();
  });

  it("keeps every id exactly once (what PUT /admin/banners/order requires)", () => {
    for (let from = 0; from < ids.length; from += 1) {
      for (let to = 0; to < ids.length; to += 1) {
        const next = moveTo(ids, from, to) ?? ids;
        expect([...next].sort()).toEqual([...ids]);
      }
    }
  });
});
