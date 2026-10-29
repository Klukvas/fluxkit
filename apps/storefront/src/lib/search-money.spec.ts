import { describe, expect, it } from "vitest";
import { decimalToMinorUnits, minorUnitsToInput } from "./search-money";

describe("decimalToMinorUnits (the price filter's text to minor units, integer arithmetic only)", () => {
  it.each([
    ["12", 2, 1200],
    ["12.5", 2, 1250],
    ["12,5", 2, 1250],
    ["12.50", 2, 1250],
    ["0.07", 2, 7],
    [" 3 ", 2, 300],
    ["0", 2, 0],
    ["5", 0, 5],
    ["1.234", 3, 1234],
    ["1.2", 3, 1200],
  ])("reads %j with %i digits as %i", (text, exponent, expected) => {
    expect(decimalToMinorUnits(text, exponent)).toBe(expected);
  });

  it.each([
    ["", 2],
    ["abc", 2],
    ["-1", 2],
    ["1e3", 2],
    ["1.234", 2],
    ["1.5", 0],
    ["1.", 2],
    [".5", 2],
    ["1 000", 2],
    ["1..5", 2],
    ["9999999999999999", 2],
  ])("refuses %j with %i digits", (text, exponent) => {
    expect(decimalToMinorUnits(text, exponent)).toBeNull();
  });

  it("never loses a cent to floating point (0.29 is 29, not 28)", () => {
    expect(decimalToMinorUnits("0.29", 2)).toBe(29);
    expect(decimalToMinorUnits("1.15", 2)).toBe(115);
    expect(decimalToMinorUnits("4.35", 2)).toBe(435);
  });

  it("stays exact up to the largest safe integer, where a float product is not (review F5)", () => {
    // `Math.round(Number("90000000000000.01") * 100)` is 9000000000000002, one cent too many.
    expect(decimalToMinorUnits("90000000000000.01", 2)).toBe(9_000_000_000_000_001);
    expect(decimalToMinorUnits("9007199254740.991", 3)).toBe(Number.MAX_SAFE_INTEGER);
    expect(decimalToMinorUnits("90071992547409.91", 2)).toBe(Number.MAX_SAFE_INTEGER);
    expect(decimalToMinorUnits("90071992547409.92", 2)).toBeNull();
  });
});

describe("minorUnitsToInput (minor units back into the price boxes)", () => {
  it.each([
    [1250, 2, "12.5"],
    [1200, 2, "12"],
    [7, 2, "0.07"],
    [0, 2, "0"],
    [5, 0, "5"],
    [1234, 3, "1.234"],
  ])("writes %i with %i digits as %j", (amount, exponent, expected) => {
    expect(minorUnitsToInput(amount, exponent)).toBe(expected);
  });

  it("reads back what it wrote", () => {
    for (const amount of [0, 1, 99, 100, 101, 123456]) {
      expect(decimalToMinorUnits(minorUnitsToInput(amount, 2), 2)).toBe(amount);
    }
  });
});
