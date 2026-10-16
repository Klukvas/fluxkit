import { describe, expect, it } from "vitest";
import { deepFreeze } from "../catalog/test-support.js";
import { CURRENCY_CODES } from "./currency.js";
import type { SupportedCurrency } from "./currency.js";
import { MAX_AMOUNT, MAX_PERCENTAGE_BASIS_POINTS, MAX_QUANTITY } from "./limits.js";
import {
  addMoney,
  compareMoney,
  createMoney,
  isZero,
  multiplyByQuantity,
  negateMoney,
  parseDecimalString,
  percentageOf,
  subtractMoney,
  toDecimalString,
} from "./money.js";
import type { Money, RoundingMode } from "./money.js";

function money(amount: number, currency: SupportedCurrency = "UAH"): Money {
  return deepFreeze({ amount, currency });
}

function amountOrFail(result: { ok: boolean; money?: Money; reason?: string }): number {
  if (!result.ok || result.money === undefined) {
    throw new Error(`expected ok, got ${String(result.reason)}`);
  }
  return result.money.amount;
}

describe("createMoney", () => {
  it("creates money from an integer and a supported currency", () => {
    expect(createMoney(0, "UAH")).toEqual({ ok: true, money: { amount: 0, currency: "UAH" } });
    expect(createMoney(1, "USD")).toEqual({ ok: true, money: { amount: 1, currency: "USD" } });
    expect(createMoney(-5, "JPY")).toEqual({ ok: true, money: { amount: -5, currency: "JPY" } });
  });

  it("accepts exactly the limits and nothing beyond", () => {
    expect(createMoney(MAX_AMOUNT, "UAH")).toEqual({
      ok: true,
      money: { amount: MAX_AMOUNT, currency: "UAH" },
    });
    expect(createMoney(-MAX_AMOUNT, "UAH")).toEqual({
      ok: true,
      money: { amount: -MAX_AMOUNT, currency: "UAH" },
    });
    expect(createMoney(MAX_AMOUNT + 1, "UAH")).toEqual({
      ok: false,
      reason: "amount_out_of_range",
    });
    expect(createMoney(-MAX_AMOUNT - 1, "UAH")).toEqual({
      ok: false,
      reason: "amount_out_of_range",
    });
  });

  it("rejects unsafe integers as out of range", () => {
    for (const amount of [2 ** 53, 2 ** 53 + 2, Number.MAX_SAFE_INTEGER, -(2 ** 53), 1e21]) {
      expect(createMoney(amount, "UAH"), String(amount)).toEqual({
        ok: false,
        reason: "amount_out_of_range",
      });
    }
  });

  it("rejects fractions and infinities as not an integer", () => {
    for (const amount of [0.5, 1.5, -0.1, 1e-7, Infinity, -Infinity]) {
      expect(createMoney(amount, "UAH"), String(amount)).toEqual({
        ok: false,
        reason: "not_an_integer",
      });
    }
  });

  it("rejects values that are not numbers", () => {
    for (const value of [NaN, "12", "1.5", null, undefined, {}, [], true, 10n]) {
      expect(createMoney(value as never, "UAH"), String(value)).toEqual({
        ok: false,
        reason: "not_a_number",
      });
    }
  });

  it("rejects an unsupported currency, including inherited object keys", () => {
    for (const currency of ["RUB", "uah", "", "__proto__", "constructor", "toString", 5, null]) {
      expect(createMoney(100, currency as never), String(currency)).toEqual({
        ok: false,
        reason: "unsupported_currency",
      });
    }
  });

  it("never produces negative zero", () => {
    const result = createMoney(-0, "UAH");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.is(result.money.amount, 0)).toBe(true);
    }
  });

  it("returns a frozen value", () => {
    const result = createMoney(100, "UAH");
    expect(result.ok && Object.isFrozen(result.money)).toBe(true);
  });
});

describe("addMoney and subtractMoney", () => {
  it("adds and subtracts amounts of one currency", () => {
    expect(addMoney(money(100), money(250))).toEqual({
      ok: true,
      money: { amount: 350, currency: "UAH" },
    });
    expect(subtractMoney(money(100), money(250))).toEqual({
      ok: true,
      money: { amount: -150, currency: "UAH" },
    });
    expect(addMoney(money(-100), money(100))).toEqual({
      ok: true,
      money: { amount: 0, currency: "UAH" },
    });
  });

  it("never returns negative zero", () => {
    const sum = addMoney(money(-1), money(1));
    const difference = subtractMoney(money(0), money(0));
    expect(sum.ok && Object.is(sum.money.amount, 0)).toBe(true);
    expect(difference.ok && Object.is(difference.money.amount, 0)).toBe(true);
  });

  it("refuses to mix currencies", () => {
    expect(addMoney(money(1, "UAH"), money(1, "USD"))).toEqual({
      ok: false,
      reason: "currency_mismatch",
    });
    expect(subtractMoney(money(1, "UAH"), money(1, "USD"))).toEqual({
      ok: false,
      reason: "currency_mismatch",
    });
  });

  it("accepts a result exactly at the limit and refuses one above it", () => {
    expect(addMoney(money(MAX_AMOUNT - 1), money(1))).toEqual({
      ok: true,
      money: { amount: MAX_AMOUNT, currency: "UAH" },
    });
    expect(addMoney(money(MAX_AMOUNT), money(1))).toEqual({
      ok: false,
      reason: "amount_out_of_range",
    });
    expect(addMoney(money(-MAX_AMOUNT), money(-1))).toEqual({
      ok: false,
      reason: "amount_out_of_range",
    });
    expect(addMoney(money(MAX_AMOUNT), money(MAX_AMOUNT))).toEqual({
      ok: false,
      reason: "amount_out_of_range",
    });
    expect(subtractMoney(money(MAX_AMOUNT), money(-1))).toEqual({
      ok: false,
      reason: "amount_out_of_range",
    });
    expect(subtractMoney(money(-MAX_AMOUNT), money(1))).toEqual({
      ok: false,
      reason: "amount_out_of_range",
    });
    expect(subtractMoney(money(MAX_AMOUNT), money(-0))).toEqual({
      ok: true,
      money: { amount: MAX_AMOUNT, currency: "UAH" },
    });
    expect(subtractMoney(money(-MAX_AMOUNT), money(-MAX_AMOUNT))).toEqual({
      ok: true,
      money: { amount: 0, currency: "UAH" },
    });
  });

  it("reports hand-built invalid money instead of computing with it", () => {
    for (const bad of [
      { amount: 1.5, currency: "UAH" },
      { amount: NaN, currency: "UAH" },
      { amount: MAX_AMOUNT + 1, currency: "UAH" },
      { amount: 1, currency: "RUB" },
      { amount: "1", currency: "UAH" },
    ]) {
      expect(addMoney(bad as never, money(1)), JSON.stringify(bad)).toEqual({
        ok: false,
        reason: "invalid_money",
      });
      expect(subtractMoney(money(1), bad as never), JSON.stringify(bad)).toEqual({
        ok: false,
        reason: "invalid_money",
      });
    }
  });

  it("does not mutate frozen inputs and returns equal results on repeated calls", () => {
    const a = money(1234);
    const b = money(-56);
    const first = addMoney(a, b);
    const second = addMoney(a, b);
    expect(first).toEqual(second);
    expect(a).toEqual({ amount: 1234, currency: "UAH" });
    expect(b).toEqual({ amount: -56, currency: "UAH" });
  });
});

describe("multiplyByQuantity", () => {
  it("multiplies by an integer quantity", () => {
    expect(multiplyByQuantity(money(1999), 3)).toEqual({
      ok: true,
      money: { amount: 5997, currency: "UAH" },
    });
    expect(multiplyByQuantity(money(-250), 4)).toEqual({
      ok: true,
      money: { amount: -1000, currency: "UAH" },
    });
  });

  it("handles quantity 0 and 1 and never returns negative zero", () => {
    expect(multiplyByQuantity(money(500), 1)).toEqual({
      ok: true,
      money: { amount: 500, currency: "UAH" },
    });
    const zero = multiplyByQuantity(money(-500), 0);
    expect(zero.ok && Object.is(zero.money.amount, 0)).toBe(true);
    const zeroOfZero = multiplyByQuantity(money(0), 5);
    expect(zeroOfZero.ok && Object.is(zeroOfZero.money.amount, 0)).toBe(true);
  });

  it("accepts the maximum quantity and refuses one above it", () => {
    expect(multiplyByQuantity(money(1), MAX_QUANTITY)).toEqual({
      ok: true,
      money: { amount: MAX_QUANTITY, currency: "UAH" },
    });
    expect(multiplyByQuantity(money(0), MAX_QUANTITY + 1)).toEqual({
      ok: false,
      reason: "invalid_quantity",
    });
    expect(multiplyByQuantity(money(1), MAX_QUANTITY + 1)).toEqual({
      ok: false,
      reason: "invalid_quantity",
    });
  });

  it("refuses a bad quantity", () => {
    for (const quantity of [-1, 0.5, NaN, Infinity, "2", null, undefined, 2n, 2 ** 53]) {
      expect(multiplyByQuantity(money(1), quantity as never), String(quantity)).toEqual({
        ok: false,
        reason: "invalid_quantity",
      });
    }
  });

  it("keeps the product within the amount limit exactly", () => {
    expect(multiplyByQuantity(money(MAX_AMOUNT), 1)).toEqual({
      ok: true,
      money: { amount: MAX_AMOUNT, currency: "UAH" },
    });
    expect(multiplyByQuantity(money(MAX_AMOUNT / 2), 2)).toEqual({
      ok: true,
      money: { amount: MAX_AMOUNT, currency: "UAH" },
    });
    expect(multiplyByQuantity(money(MAX_AMOUNT / 2 + 1), 2)).toEqual({
      ok: false,
      reason: "amount_out_of_range",
    });
    expect(multiplyByQuantity(money(-MAX_AMOUNT), 2)).toEqual({
      ok: false,
      reason: "amount_out_of_range",
    });
    expect(multiplyByQuantity(money(MAX_AMOUNT), MAX_QUANTITY)).toEqual({
      ok: false,
      reason: "amount_out_of_range",
    });
  });

  it("reports hand-built invalid money", () => {
    expect(multiplyByQuantity({ amount: 0.5, currency: "UAH" } as never, 2)).toEqual({
      ok: false,
      reason: "invalid_money",
    });
  });
});

describe("compareMoney (typed result, like every other money function)", () => {
  it("orders amounts of one currency", () => {
    expect(compareMoney(money(1), money(2))).toEqual({ ok: true, ordering: -1 });
    expect(compareMoney(money(2), money(1))).toEqual({ ok: true, ordering: 1 });
    expect(compareMoney(money(5), money(5))).toEqual({ ok: true, ordering: 0 });
    expect(compareMoney(money(-5), money(-6))).toEqual({ ok: true, ordering: 1 });
    expect(compareMoney(money(MAX_AMOUNT), money(-MAX_AMOUNT))).toEqual({ ok: true, ordering: 1 });
  });

  it("treats negative zero as zero", () => {
    expect(compareMoney(money(-0), money(0))).toEqual({ ok: true, ordering: 0 });
  });

  it("refuses different currencies (never throws, never compares the numbers)", () => {
    expect(compareMoney(money(1, "UAH"), money(1, "USD"))).toEqual({
      ok: false,
      reason: "currency_mismatch",
    });
    expect(compareMoney(money(1, "UAH"), money(2, "USD"))).toEqual({
      ok: false,
      reason: "currency_mismatch",
    });
  });

  it("reports hand-built invalid money", () => {
    expect(compareMoney({ amount: 1.5, currency: "UAH" } as never, money(1))).toEqual({
      ok: false,
      reason: "invalid_money",
    });
  });
});

describe("negateMoney and isZero", () => {
  /** negateMoney gives a typed result; this unwraps it for the arithmetic cases. */
  function negated(value: Money): Money {
    const result = negateMoney(value);
    if (!result.ok) {
      throw new Error(`negateMoney refused: ${result.reason}`);
    }
    return result.money;
  }

  it("flips the sign", () => {
    expect(negateMoney(money(5))).toEqual({ ok: true, money: { amount: -5, currency: "UAH" } });
    expect(negated(money(-5, "EUR"))).toEqual({ amount: 5, currency: "EUR" });
    expect(negated(money(MAX_AMOUNT))).toEqual({ amount: -MAX_AMOUNT, currency: "UAH" });
  });

  it("returns +0 for zero, never -0", () => {
    expect(Object.is(negated(money(0)).amount, 0)).toBe(true);
    expect(Object.is(negated(money(-0)).amount, 0)).toBe(true);
  });

  it("is its own inverse and does not mutate", () => {
    const original = money(42);
    expect(negated(negated(original))).toEqual(original);
    expect(original).toEqual({ amount: 42, currency: "UAH" });
  });

  it("reports invalid money instead of returning it unchanged (R10)", () => {
    for (const bad of [
      { amount: Number.NaN, currency: "XXX" },
      { amount: 1.5, currency: "UAH" },
      { amount: MAX_AMOUNT + 1, currency: "UAH" },
      { amount: Number.POSITIVE_INFINITY, currency: "UAH" },
      { amount: 1, currency: "XXX" },
      null,
    ]) {
      expect(negateMoney(bad as never), JSON.stringify(bad)).toEqual({
        ok: false,
        reason: "invalid_money",
      });
    }
  });

  it("isZero is true only for zero (also negative zero)", () => {
    expect(isZero(money(0))).toBe(true);
    expect(isZero(money(-0))).toBe(true);
    expect(isZero(money(1))).toBe(false);
    expect(isZero(money(-1))).toBe(false);
  });

  it("isZero throws a RangeError for invalid money instead of answering false (R10)", () => {
    for (const bad of [
      { amount: Number.NaN, currency: "UAH" },
      { amount: 1.5, currency: "UAH" },
      { amount: 0, currency: "XXX" },
      undefined,
    ]) {
      expect(() => isZero(bad as never), JSON.stringify(bad)).toThrow(RangeError);
    }
  });
});

describe("percentageOf", () => {
  const MODES: readonly RoundingMode[] = ["half_away_from_zero", "half_even", "floor", "ceil"];

  function pct(amount: number, basisPoints: number, mode?: RoundingMode): number {
    return amountOrFail(percentageOf(money(amount), basisPoints, mode));
  }

  it("computes plain percentages", () => {
    expect(pct(10_000, 2000)).toBe(2000);
    expect(pct(1999, 5000)).toBe(1000); // 999.5 rounds away from zero
    expect(pct(12345, 10_000)).toBe(12345);
    expect(pct(12345, 12345)).toBe(15240); // 12345 * 1.2345 = 15239.9025
  });

  it("handles basis points 0, 1, 5000, 10000 and 12345", () => {
    expect(pct(999_999, 0)).toBe(0);
    expect(pct(10_000, 1)).toBe(1);
    expect(pct(10_000, 5000)).toBe(5000);
    expect(pct(10_000, 10_000)).toBe(10_000);
    expect(pct(10_000, 12_345)).toBe(12_345);
    expect(pct(1, 1)).toBe(0); // 0.0001 rounds to 0
    expect(pct(5000, 1)).toBe(1); // exactly 0.5 rounds away from zero
  });

  it("uses half away from zero by default", () => {
    expect(amountOrFail(percentageOf(money(250), 100))).toBe(3);
    expect(amountOrFail(percentageOf(money(-250), 100))).toBe(-3);
    expect(amountOrFail(percentageOf(money(250), 100, undefined))).toBe(3);
  });

  // 50 / 10000 * 100 = 0.5 etc.: amount * 100 bp = amount / 100.
  const HALVES: ReadonlyArray<{
    readonly amount: number;
    readonly expected: Record<RoundingMode, number>;
  }> = [
    { amount: 50, expected: { half_away_from_zero: 1, half_even: 0, floor: 0, ceil: 1 } },
    { amount: 150, expected: { half_away_from_zero: 2, half_even: 2, floor: 1, ceil: 2 } },
    { amount: 250, expected: { half_away_from_zero: 3, half_even: 2, floor: 2, ceil: 3 } },
    { amount: 350, expected: { half_away_from_zero: 4, half_even: 4, floor: 3, ceil: 4 } },
    { amount: -50, expected: { half_away_from_zero: -1, half_even: 0, floor: -1, ceil: 0 } },
    { amount: -150, expected: { half_away_from_zero: -2, half_even: -2, floor: -2, ceil: -1 } },
    { amount: -250, expected: { half_away_from_zero: -3, half_even: -2, floor: -3, ceil: -2 } },
    { amount: -350, expected: { half_away_from_zero: -4, half_even: -4, floor: -4, ceil: -3 } },
  ];

  it.each(HALVES)("rounds the exact half $amount / 100 in every mode", ({ amount, expected }) => {
    for (const mode of MODES) {
      expect(pct(amount, 100, mode), `${amount} ${mode}`).toBe(expected[mode]);
    }
  });

  it("rounds values just off the half by their distance", () => {
    // 1.4, 1.6 and the negatives.
    expect(pct(140, 100, "half_away_from_zero")).toBe(1);
    expect(pct(160, 100, "half_away_from_zero")).toBe(2);
    expect(pct(-140, 100, "half_away_from_zero")).toBe(-1);
    expect(pct(-160, 100, "half_away_from_zero")).toBe(-2);
    expect(pct(140, 100, "half_even")).toBe(1);
    expect(pct(160, 100, "half_even")).toBe(2);
    expect(pct(-140, 100, "half_even")).toBe(-1);
    expect(pct(-160, 100, "half_even")).toBe(-2);
    // Just above and just below the half.
    expect(pct(151, 100, "half_even")).toBe(2);
    expect(pct(149, 100, "half_even")).toBe(1);
    expect(pct(-151, 100, "half_even")).toBe(-2);
    expect(pct(-149, 100, "half_even")).toBe(-1);
  });

  it("floor goes toward negative infinity and ceil toward positive infinity", () => {
    expect(pct(101, 100, "floor")).toBe(1);
    expect(pct(101, 100, "ceil")).toBe(2);
    expect(pct(-101, 100, "floor")).toBe(-2);
    expect(pct(-101, 100, "ceil")).toBe(-1);
    // Exact results stay exact in every mode.
    for (const mode of MODES) {
      expect(pct(200, 100, mode)).toBe(2);
      expect(pct(-200, 100, mode)).toBe(-2);
    }
  });

  it("never returns negative zero", () => {
    for (const mode of MODES) {
      for (const [amount, bp] of [
        [-1, 1],
        [-1, 0],
        [0, 5000],
        [-49, 100],
        [-50, 100],
      ] as const) {
        expect(Object.is(pct(amount, bp, mode), -0), `${amount} ${bp} ${mode}`).toBe(false);
      }
    }
  });

  it("keeps the currency", () => {
    expect(percentageOf(money(1000, "JPY"), 5000)).toEqual({
      ok: true,
      money: { amount: 500, currency: "JPY" },
    });
  });

  it("is exact where floating point is not", () => {
    // 999_999_999_999 * 5000 / 10000 = 499_999_999_999.5, and the products exceed 2^53.
    expect(pct(999_999_999_999, 5000)).toBe(500_000_000_000);
    expect(pct(999_999_999_999, 5000, "floor")).toBe(499_999_999_999);
    expect(pct(999_999_999_999, 5000, "half_even")).toBe(500_000_000_000);
    expect(pct(999_999_999_997, 5000, "half_even")).toBe(499_999_999_998);
    // 999_999_999_999 * 9999 = 9_998_999_999_990_001 is above 2^53 and not representable as a double.
    expect(pct(999_999_999_999, 9999, "floor")).toBe(999_899_999_999);
    expect(pct(999_999_999_999, 9999, "ceil")).toBe(999_900_000_000);
    expect(pct(999_999_999_999, 9999)).toBe(999_899_999_999);
  });

  it("accepts the maximum percentage while the result stays in range", () => {
    expect(pct(MAX_AMOUNT / 100, MAX_PERCENTAGE_BASIS_POINTS)).toBe(MAX_AMOUNT);
    expect(pct(-MAX_AMOUNT / 100, MAX_PERCENTAGE_BASIS_POINTS)).toBe(-MAX_AMOUNT);
    expect(pct(MAX_AMOUNT, 10_000)).toBe(MAX_AMOUNT);
    expect(pct(0, MAX_PERCENTAGE_BASIS_POINTS)).toBe(0);
  });

  it("refuses a result beyond the amount limit", () => {
    expect(percentageOf(money(MAX_AMOUNT), 10_001)).toEqual({
      ok: false,
      reason: "amount_out_of_range",
    });
    expect(percentageOf(money(MAX_AMOUNT / 100 + 1), MAX_PERCENTAGE_BASIS_POINTS)).toEqual({
      ok: false,
      reason: "amount_out_of_range",
    });
    expect(percentageOf(money(-MAX_AMOUNT), MAX_PERCENTAGE_BASIS_POINTS)).toEqual({
      ok: false,
      reason: "amount_out_of_range",
    });
    // Rounding across the limit is judged on the rounded result:
    // 990_099_009_901 * 1.01 = 1_000_000_000_000.01
    expect(percentageOf(money(990_099_009_901), 10_100, "ceil")).toEqual({
      ok: false,
      reason: "amount_out_of_range",
    });
    expect(percentageOf(money(990_099_009_901), 10_100, "floor")).toEqual({
      ok: true,
      money: { amount: MAX_AMOUNT, currency: "UAH" },
    });
    expect(percentageOf(money(990_099_009_901), 10_100)).toEqual({
      ok: true,
      money: { amount: MAX_AMOUNT, currency: "UAH" },
    });
  });

  it("refuses bad basis points", () => {
    for (const basisPoints of [
      -1,
      MAX_PERCENTAGE_BASIS_POINTS + 1,
      0.5,
      1.5,
      NaN,
      Infinity,
      "100",
      null,
      undefined,
      100n,
    ]) {
      expect(percentageOf(money(100), basisPoints as never), String(basisPoints)).toEqual({
        ok: false,
        reason: "invalid_basis_points",
      });
    }
  });

  it("throws RangeError for an unknown rounding mode (misconfiguration)", () => {
    expect(() => percentageOf(money(100), 100, "half_up" as never)).toThrow(RangeError);
    expect(() => percentageOf(money(100), 100, "toString" as never)).toThrow(RangeError);
  });

  it("reports hand-built invalid money", () => {
    expect(percentageOf({ amount: 1.5, currency: "UAH" } as never, 100)).toEqual({
      ok: false,
      reason: "invalid_money",
    });
    expect(percentageOf({ amount: 1, currency: "XXX" } as never, 100)).toEqual({
      ok: false,
      reason: "invalid_money",
    });
  });

  it("does not mutate frozen inputs and returns equal results on repeated calls", () => {
    const input = money(12_345);
    const first = percentageOf(input, 1234, "half_even");
    const second = percentageOf(input, 1234, "half_even");
    expect(first).toEqual(second);
    expect(input).toEqual({ amount: 12_345, currency: "UAH" });
  });
});

describe("toDecimalString", () => {
  it("formats with the exponent of the currency", () => {
    expect(toDecimalString(money(123_456))).toBe("1234.56");
    expect(toDecimalString(money(5))).toBe("0.05");
    expect(toDecimalString(money(50))).toBe("0.50");
    expect(toDecimalString(money(100))).toBe("1.00");
    expect(toDecimalString(money(0))).toBe("0.00");
    expect(toDecimalString(money(5, "KWD"))).toBe("0.005");
    expect(toDecimalString(money(1234, "KWD"))).toBe("1.234");
    expect(toDecimalString(money(1000, "KWD"))).toBe("1.000");
    expect(toDecimalString(money(0, "KWD"))).toBe("0.000");
  });

  it("has no fraction for a currency without minor units", () => {
    expect(toDecimalString(money(0, "JPY"))).toBe("0");
    expect(toDecimalString(money(5, "JPY"))).toBe("5");
    expect(toDecimalString(money(1234, "JPY"))).toBe("1234");
  });

  it("keeps leading zeros of the fraction", () => {
    expect(toDecimalString(money(1, "UAH"))).toBe("0.01");
    expect(toDecimalString(money(101, "UAH"))).toBe("1.01");
    expect(toDecimalString(money(1001, "KWD"))).toBe("1.001");
    expect(toDecimalString(money(10_005, "UAH"))).toBe("100.05");
  });

  it("writes negative amounts with a leading minus", () => {
    expect(toDecimalString(money(-5))).toBe("-0.05");
    expect(toDecimalString(money(-123_456))).toBe("-1234.56");
    expect(toDecimalString(money(-7, "JPY"))).toBe("-7");
    expect(toDecimalString(money(-5, "KWD"))).toBe("-0.005");
  });

  it("writes zero without a sign (also negative zero)", () => {
    expect(toDecimalString(money(-0))).toBe("0.00");
  });

  it("formats the limits exactly", () => {
    expect(toDecimalString(money(MAX_AMOUNT))).toBe("10000000000.00");
    expect(toDecimalString(money(-MAX_AMOUNT))).toBe("-10000000000.00");
    expect(toDecimalString(money(MAX_AMOUNT, "JPY"))).toBe("1000000000000");
    expect(toDecimalString(money(MAX_AMOUNT, "KWD"))).toBe("1000000000.000");
  });

  it("throws RangeError for hand-built invalid money (it cannot return a typed result)", () => {
    expect(() => toDecimalString({ amount: 1.5, currency: "UAH" } as never)).toThrow(RangeError);
    expect(() => toDecimalString({ amount: 1, currency: "RUB" } as never)).toThrow(RangeError);
    expect(() => toDecimalString({ amount: MAX_AMOUNT + 1, currency: "UAH" } as never)).toThrow(
      RangeError,
    );
  });
});

describe("parseDecimalString", () => {
  function parsed(text: unknown, currency: SupportedCurrency = "UAH"): number {
    return amountOrFail(parseDecimalString(text as string, currency));
  }

  it("parses the accepted grammar", () => {
    expect(parsed("1234.56")).toBe(123_456);
    expect(parsed("0.05")).toBe(5);
    expect(parsed("5")).toBe(500);
    expect(parsed("5.5")).toBe(550);
    expect(parsed("5.50")).toBe(550);
    expect(parsed("0")).toBe(0);
    expect(parsed("0.00")).toBe(0);
    expect(parsed("-0.05")).toBe(-5);
    expect(parsed("-12")).toBe(-1200);
    expect(parsed("1.234", "KWD")).toBe(1234);
    expect(parsed("1.2", "KWD")).toBe(1200);
    expect(parsed("1234", "JPY")).toBe(1234);
    expect(parsed("-7", "JPY")).toBe(-7);
  });

  it("accepts leading zeros of the integer part", () => {
    expect(parsed("007.5")).toBe(750);
    expect(parsed("0000")).toBe(0);
  });

  it("never returns negative zero", () => {
    expect(Object.is(parsed("0"), 0)).toBe(true);
    expect(Object.is(parsed("0.00"), 0)).toBe(true);
  });

  it("rejects more decimals than the currency has", () => {
    expect(parseDecimalString("1.234", "UAH")).toEqual({ ok: false, reason: "too_many_decimals" });
    expect(parseDecimalString("1.230", "UAH")).toEqual({ ok: false, reason: "too_many_decimals" });
    expect(parseDecimalString("1.0", "JPY")).toEqual({ ok: false, reason: "too_many_decimals" });
    expect(parseDecimalString("1.2345", "KWD")).toEqual({ ok: false, reason: "too_many_decimals" });
  });

  it("rejects everything outside the strict grammar", () => {
    const bad = [
      "",
      " ",
      "1,5",
      "1,50",
      "1e3",
      "1E3",
      "1.5e1",
      " 1.50",
      "1.50 ",
      "1. 50",
      "1 000.00",
      "1\n",
      "\n1",
      "+1.00",
      "+0",
      ".5",
      "5.",
      ".",
      "-",
      "-.5",
      "--1",
      "1..5",
      "1.5.5",
      "0x10",
      "NaN",
      "Infinity",
      "abc",
      "1_000",
      "١٢", // Arabic-Indic digits
      "１２", // full-width digits
      "1 000",
      "−1.00", // Unicode minus sign
    ];
    for (const text of bad) {
      expect(parseDecimalString(text, "UAH"), JSON.stringify(text)).toEqual({
        ok: false,
        reason: "invalid_format",
      });
    }
  });

  it("rejects negative zero", () => {
    expect(parseDecimalString("-0", "UAH")).toEqual({ ok: false, reason: "negative_zero" });
    expect(parseDecimalString("-0.00", "UAH")).toEqual({ ok: false, reason: "negative_zero" });
    expect(parseDecimalString("-0", "JPY")).toEqual({ ok: false, reason: "negative_zero" });
    expect(parseDecimalString("-0.000", "KWD")).toEqual({ ok: false, reason: "negative_zero" });
    expect(parseDecimalString("-00.0", "UAH")).toEqual({ ok: false, reason: "negative_zero" });
  });

  it("accepts the limits and rejects values beyond them", () => {
    expect(parsed("10000000000.00")).toBe(MAX_AMOUNT);
    expect(parsed("-10000000000.00")).toBe(-MAX_AMOUNT);
    expect(parseDecimalString("10000000000.01", "UAH")).toEqual({
      ok: false,
      reason: "amount_out_of_range",
    });
    expect(parseDecimalString("-10000000000.01", "UAH")).toEqual({
      ok: false,
      reason: "amount_out_of_range",
    });
    expect(parsed("1000000000000", "JPY")).toBe(MAX_AMOUNT);
    expect(parseDecimalString("1000000000001", "JPY")).toEqual({
      ok: false,
      reason: "amount_out_of_range",
    });
    expect(parseDecimalString("9".repeat(400), "UAH")).toEqual({
      ok: false,
      reason: "amount_out_of_range",
    });
    expect(parseDecimalString(`${"0".repeat(400)}1`, "UAH")).toEqual({
      ok: true,
      money: { amount: 100, currency: "UAH" },
    });
  });

  it("rejects non-strings", () => {
    for (const value of [undefined, null, 1.5, 100, {}, [], ["1.00"], true, 1n]) {
      expect(parseDecimalString(value as never, "UAH"), String(value)).toEqual({
        ok: false,
        reason: "not_a_string",
      });
    }
  });

  it("rejects an unsupported currency", () => {
    for (const currency of ["RUB", "uah", "__proto__", "constructor", "toString", "", 1, null]) {
      expect(parseDecimalString("1.00", currency as never), String(currency)).toEqual({
        ok: false,
        reason: "unsupported_currency",
      });
    }
  });

  it("round-trips every currency exponent exactly", () => {
    const amounts = [0, 1, 5, 9, 10, 99, 100, 101, 999, 1000, 1001, 123_456, 7_000_000, MAX_AMOUNT];
    for (const currency of CURRENCY_CODES) {
      for (const amount of [...amounts, ...amounts.map((value) => -value)]) {
        if (Object.is(amount, -0)) {
          continue; // -0 is not an amount; zero is covered by +0
        }
        const text = toDecimalString(money(amount, currency));
        expect(parseDecimalString(text, currency), `${currency} ${amount} ${text}`).toEqual({
          ok: true,
          money: { amount: amount === 0 ? 0 : amount, currency },
        });
      }
    }
  });

  it("returns frozen money", () => {
    const result = parseDecimalString("1.00", "UAH");
    expect(result.ok && Object.isFrozen(result.money)).toBe(true);
  });
});
