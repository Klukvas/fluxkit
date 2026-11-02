import { describe, expect, it } from "vitest";
import { discountPercent } from "./discount";

describe("discountPercent (the saving of a compare-at price, whole percent rounded down)", () => {
  it("is the saving in whole percent", () => {
    expect(discountPercent(59_900, 79_900)).toBe(25); // 25.03 %
    expect(discountPercent(34_900, 44_900)).toBe(22); // 22.27 %
    expect(discountPercent(50_00, 100_00)).toBe(50);
  });

  it("rounds down, never overstating a saving", () => {
    expect(discountPercent(129_900, 159_900)).toBe(18); // 18.76 %, not 19
    expect(discountPercent(1, 3)).toBe(66); // 66.67 %
    expect(discountPercent(99, 100)).toBe(1);
  });

  it("is null when there is no saving: compare-at equal to or below the price", () => {
    expect(discountPercent(1_000, 1_000)).toBeNull();
    expect(discountPercent(1_000, 999)).toBeNull();
  });

  it("is null when the saving rounds down to 0 % (a badge saying -0 % misleads)", () => {
    expect(discountPercent(99_901, 100_000)).toBeNull(); // 0.099 %
    expect(discountPercent(995, 1_000)).toBeNull(); // 0.5 %
  });

  it("is 100 for a free item with a compare-at price", () => {
    expect(discountPercent(0, 1_000)).toBe(100);
  });

  it("is null for input that is not a whole non-negative amount", () => {
    expect(discountPercent(-1, 1_000)).toBeNull();
    expect(discountPercent(10.5, 1_000)).toBeNull();
    expect(discountPercent(10, 1_000.5)).toBeNull();
    expect(discountPercent(10, 0)).toBeNull();
    expect(discountPercent(Number.NaN, 1_000)).toBeNull();
    expect(discountPercent(10, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("stays exact for the largest amounts the API allows", () => {
    expect(discountPercent(Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER)).toBeNull();
    expect(discountPercent(1, Number.MAX_SAFE_INTEGER)).toBe(99);
    expect(discountPercent(4_503_599_627_370_496, 9_007_199_254_740_991)).toBe(49); // 49.99999999999999 %
  });
});
