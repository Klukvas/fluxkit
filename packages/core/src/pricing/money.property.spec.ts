import { describe, expect, it } from "vitest";
import { deepFreeze } from "../catalog/test-support.js";
import { CURRENCY_CODES, exponentOf } from "./currency.js";
import type { SupportedCurrency } from "./currency.js";
import { MAX_AMOUNT, MAX_PERCENTAGE_BASIS_POINTS, MAX_QUANTITY } from "./limits.js";
import {
  addMoney,
  multiplyByQuantity,
  parseDecimalString,
  percentageOf,
  subtractMoney,
  toDecimalString,
} from "./money.js";
import type { Money, RoundingMode } from "./money.js";

/*
 * Property-style tests. Everything random comes from a seeded generator (never Math.random), so a failure
 * reproduces exactly. Expected values come from reference code below that is written differently from
 * the production code: BigInt floor division with a remainder compared against the divisor, instead of
 * production's "work on the absolute value and add one when the remainder asks for it".
 */

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Random {
  private readonly next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  /** Integer in [low, high], both inclusive; high - low stays far below 2^53. */
  int(low: number, high: number): number {
    return low + Math.floor(this.next() * (high - low + 1));
  }

  pick<T>(items: readonly T[]): T {
    const item = items[this.int(0, items.length - 1)];
    if (item === undefined) {
      throw new Error("pick from an empty list");
    }
    return item;
  }

  sign(): 1 | -1 {
    return this.next() < 0.5 ? 1 : -1;
  }

  /** Non-negative amount from a mix of magnitudes, including the edges of the allowed range. */
  magnitude(): number {
    switch (this.int(0, 7)) {
      case 0:
        return this.int(0, 9);
      case 1:
        return this.int(0, 10_000);
      case 2:
        return this.int(0, 100_000_000);
      case 3:
        return this.int(0, MAX_AMOUNT);
      case 4:
        return MAX_AMOUNT - this.int(0, 5);
      case 5:
        return Math.floor(MAX_AMOUNT / 2) + this.int(-3, 3);
      case 6:
        return this.int(MAX_AMOUNT - 1_000_000, MAX_AMOUNT);
      default:
        return this.int(0, 1_000_000_000_000);
    }
  }

  amount(): number {
    const value = this.magnitude() * this.sign();
    return value === 0 ? 0 : value;
  }

  basisPoints(): number {
    switch (this.int(0, 6)) {
      case 0:
        return this.pick([0, 1, 5000, 10_000, 12_345, MAX_PERCENTAGE_BASIS_POINTS]);
      case 1:
        return this.int(0, 100);
      case 2:
        return this.int(0, 10_000);
      case 3:
        return this.int(10_000, 20_000);
      default:
        return this.int(0, MAX_PERCENTAGE_BASIS_POINTS);
    }
  }
}

const MODES: readonly RoundingMode[] = ["half_away_from_zero", "half_even", "floor", "ceil"];

function money(amount: number, currency: SupportedCurrency = "UAH"): Money {
  return deepFreeze({ amount, currency });
}

/** amount * basisPoints / 10_000 rounded by `mode`, exact, via floor division and a remainder. */
function referencePercentage(amount: number, basisPoints: number, mode: RoundingMode): bigint {
  const numerator = BigInt(amount) * BigInt(basisPoints);
  const divisor = 10_000n;
  const remainder = ((numerator % divisor) + divisor) % divisor; // 0 .. divisor - 1, never negative
  const floorQuotient = (numerator - remainder) / divisor;
  const twiceRemainder = remainder * 2n;
  switch (mode) {
    case "floor":
      return floorQuotient;
    case "ceil":
      return remainder === 0n ? floorQuotient : floorQuotient + 1n;
    case "half_away_from_zero":
      if (twiceRemainder > divisor) return floorQuotient + 1n;
      if (twiceRemainder < divisor) return floorQuotient;
      return numerator > 0n ? floorQuotient + 1n : floorQuotient;
    case "half_even":
      if (twiceRemainder > divisor) return floorQuotient + 1n;
      if (twiceRemainder < divisor) return floorQuotient;
      return floorQuotient % 2n === 0n ? floorQuotient : floorQuotient + 1n;
  }
}

function expectedMoney(value: bigint, currency: SupportedCurrency = "UAH") {
  const limit = BigInt(MAX_AMOUNT);
  if (value > limit || value < -limit) {
    return { ok: false, reason: "amount_out_of_range" } as const;
  }
  return { ok: true, money: { amount: Number(value), currency } } as const;
}

/** A basis point value b and an amount a with a * b mod 10_000 === 5000 (an exact half), if one exists. */
function exactHalfAmount(random: Random, basisPoints: number): number | undefined {
  if (basisPoints === 0) {
    return undefined;
  }
  const modulus = 10_000;
  for (let candidate = 0; candidate < modulus; candidate += 1) {
    if ((candidate * basisPoints) % modulus === 5000) {
      // All solutions are candidate + k * period, where period = modulus / gcd(basisPoints, modulus).
      let period = modulus;
      for (let step = 1; step <= modulus; step += 1) {
        if ((step * basisPoints) % modulus === 0) {
          period = step;
          break;
        }
      }
      const copies = Math.floor((MAX_AMOUNT - candidate) / period);
      return (candidate + random.int(0, copies) * period) * random.sign();
    }
  }
  return undefined;
}

describe("percentageOf against an independent BigInt reference", () => {
  it("matches the reference on 40 000 random cases in all four modes (160 000 comparisons)", () => {
    const random = new Random(0xf1a5c0de);
    let cases = 0;
    let comparisons = 0;
    let inRange = 0;
    let outOfRange = 0;
    let exactHalves = 0;
    for (let index = 0; index < 40_000; index += 1) {
      let amount: number;
      let basisPoints: number;
      if (index % 4 === 0) {
        // Force exact halves: random ones almost never occur.
        basisPoints = random.int(1, 9999);
        const half = exactHalfAmount(random, basisPoints);
        if (half === undefined) {
          continue;
        }
        amount = half === 0 ? 0 : half;
        exactHalves += 1;
      } else {
        amount = random.amount();
        basisPoints = random.basisPoints();
      }
      cases += 1;
      for (const mode of MODES) {
        const actual = percentageOf(money(amount), basisPoints, mode);
        const expected = expectedMoney(referencePercentage(amount, basisPoints, mode));
        expect(actual, `${amount} * ${basisPoints}bp ${mode}`).toEqual(expected);
        if (actual.ok) {
          expect(Object.is(actual.money.amount, -0)).toBe(false);
          inRange += 1;
        } else {
          outOfRange += 1;
        }
        comparisons += 1;
      }
    }
    expect(cases).toBeGreaterThanOrEqual(20_000);
    expect(comparisons).toBe(cases * 4);
    // The generator must exercise both outcomes and the exact halves, or the test proves little.
    expect(inRange).toBeGreaterThan(40_000);
    expect(outOfRange).toBeGreaterThan(1000);
    expect(exactHalves).toBeGreaterThan(5000);
    // 160 000 BigInt comparisons take about 5 s on a slow CI runner, which is the default Vitest timeout: the case count
    // stays, the limit is explicit.
  }, 60_000);

  it("the default mode is half away from zero", () => {
    const random = new Random(7);
    for (let index = 0; index < 2000; index += 1) {
      const amount = random.amount();
      const basisPoints = random.basisPoints();
      expect(percentageOf(money(amount), basisPoints)).toEqual(
        percentageOf(money(amount), basisPoints, "half_away_from_zero"),
      );
    }
  });

  it("holds the order and symmetry laws between the modes", () => {
    const random = new Random(99);
    for (let index = 0; index < 5000; index += 1) {
      const amount = random.amount();
      const basisPoints = random.int(0, 20_000);
      const values = Object.fromEntries(
        MODES.map((mode) => {
          const result = percentageOf(money(amount), basisPoints, mode);
          return [mode, result.ok ? result.money.amount : undefined];
        }),
      ) as Record<RoundingMode, number | undefined>;
      if (Object.values(values).some((value) => value === undefined)) {
        continue;
      }
      const { floor, ceil, half_even, half_away_from_zero } = values as Record<
        RoundingMode,
        number
      >;
      expect(ceil - floor === 0 || ceil - floor === 1).toBe(true);
      for (const half of [half_even, half_away_from_zero]) {
        expect(half === floor || half === ceil).toBe(true);
      }
      // Mirror image: the half modes ignore the sign, floor and ceil swap.
      const mirrored = (mode: RoundingMode): number => {
        const result = percentageOf(money(-amount), basisPoints, mode);
        if (!result.ok) throw new Error("mirror out of range");
        return result.money.amount;
      };
      expect(mirrored("half_away_from_zero")).toBe(
        half_away_from_zero === 0 ? 0 : -half_away_from_zero,
      );
      expect(mirrored("half_even")).toBe(half_even === 0 ? 0 : -half_even);
      expect(mirrored("floor")).toBe(ceil === 0 ? 0 : -ceil);
      expect(mirrored("ceil")).toBe(floor === 0 ? 0 : -floor);
    }
  });
});

describe("addMoney, subtractMoney and multiplyByQuantity against BigInt arithmetic", () => {
  it("adds and subtracts like BigInt, including inputs at and beyond the limit, on 20 000 cases", () => {
    const random = new Random(2024);
    let nearLimit = 0;
    let refused = 0;
    for (let index = 0; index < 20_000; index += 1) {
      const left = random.amount();
      const right = random.amount();
      const currency = random.pick(CURRENCY_CODES);
      const sum = addMoney(money(left, currency), money(right, currency));
      const difference = subtractMoney(money(left, currency), money(right, currency));
      expect(sum, `${left} + ${right}`).toEqual(
        expectedMoney(BigInt(left) + BigInt(right), currency),
      );
      expect(difference, `${left} - ${right}`).toEqual(
        expectedMoney(BigInt(left) - BigInt(right), currency),
      );
      if (sum.ok) {
        expect(Object.is(sum.money.amount, -0)).toBe(false);
      } else {
        refused += 1;
      }
      if (difference.ok) {
        expect(Object.is(difference.money.amount, -0)).toBe(false);
      }
      if (Math.abs(left) > MAX_AMOUNT - 10) {
        nearLimit += 1;
      }
    }
    expect(nearLimit).toBeGreaterThan(500);
    expect(refused).toBeGreaterThan(500);
  });

  it("refuses to mix two different currencies in every random pair", () => {
    const random = new Random(5);
    for (let index = 0; index < 2000; index += 1) {
      const left = random.pick(CURRENCY_CODES);
      const right = random.pick(CURRENCY_CODES.filter((code) => code !== left));
      expect(addMoney(money(random.amount(), left), money(random.amount(), right))).toEqual({
        ok: false,
        reason: "currency_mismatch",
      });
    }
  });

  it("multiplies like BigInt on 20 000 cases and refuses what leaves the range", () => {
    const random = new Random(31337);
    let refused = 0;
    let accepted = 0;
    for (let index = 0; index < 20_000; index += 1) {
      const amount = random.amount();
      const quantity = random.pick([
        0,
        1,
        2,
        random.int(0, 1000),
        random.int(0, MAX_QUANTITY),
        MAX_QUANTITY,
      ]);
      const actual = multiplyByQuantity(money(amount), quantity);
      expect(actual, `${amount} x ${quantity}`).toEqual(
        expectedMoney(BigInt(amount) * BigInt(quantity)),
      );
      if (actual.ok) {
        accepted += 1;
        expect(Object.is(actual.money.amount, -0)).toBe(false);
      } else {
        refused += 1;
      }
    }
    expect(accepted).toBeGreaterThan(3000);
    expect(refused).toBeGreaterThan(3000);
  });
});

describe("decimal strings against a BigInt reference", () => {
  /** Integer and fraction parts through division, not the string slicing the production code uses. */
  function referenceDecimal(amount: number, currency: SupportedCurrency): string {
    const exponent = exponentOf(currency);
    const unit = 10n ** BigInt(exponent);
    const absolute = BigInt(amount < 0 ? -amount : amount);
    const sign = amount < 0 ? "-" : "";
    const integer = (absolute / unit).toString();
    if (exponent === 0) {
      return `${sign}${integer}`;
    }
    const fraction = (absolute % unit).toString().padStart(exponent, "0");
    return `${sign}${integer}.${fraction}`;
  }

  it("formats exactly and round-trips 20 000 random amounts in every currency", () => {
    const random = new Random(424242);
    for (let index = 0; index < 20_000; index += 1) {
      const amount = random.amount();
      const currency = random.pick(CURRENCY_CODES);
      const text = toDecimalString(money(amount, currency));
      expect(text, `${amount} ${currency}`).toBe(referenceDecimal(amount, currency));
      expect(parseDecimalString(text, currency), `${text} ${currency}`).toEqual({
        ok: true,
        money: { amount, currency },
      });
    }
  });

  it("parses random strings of the accepted grammar like a concatenation reference", () => {
    const random = new Random(8080);
    const digits = (count: number): string =>
      Array.from({ length: count }, () => String(random.int(0, 9))).join("");
    let accepted = 0;
    let outOfRange = 0;
    for (let index = 0; index < 20_000; index += 1) {
      const currency = random.pick(CURRENCY_CODES);
      const exponent = exponentOf(currency);
      const integerPart = digits(random.int(1, 14));
      const fractionLength = exponent === 0 ? 0 : random.int(1, exponent);
      const fractionPart = digits(fractionLength);
      const negative = random.sign() === -1;
      const text = `${negative ? "-" : ""}${integerPart}${fractionLength > 0 ? `.${fractionPart}` : ""}`;
      // Reference: glue the digits together (padding the fraction to the exponent) and let BigInt read them.
      const minorUnits = BigInt(integerPart + fractionPart.padEnd(exponent, "0"));
      const actual = parseDecimalString(text, currency);
      if (minorUnits === 0n && negative) {
        expect(actual, text).toEqual({ ok: false, reason: "negative_zero" });
      } else if (minorUnits > BigInt(MAX_AMOUNT)) {
        expect(actual, text).toEqual({ ok: false, reason: "amount_out_of_range" });
        outOfRange += 1;
      } else {
        expect(actual, text).toEqual({
          ok: true,
          money: { amount: Number(negative ? -minorUnits : minorUnits), currency },
        });
        accepted += 1;
      }
    }
    expect(accepted).toBeGreaterThan(5000);
    expect(outOfRange).toBeGreaterThan(500);
  });

  it("rejects a digit beyond the exponent in random strings", () => {
    const random = new Random(77);
    for (let index = 0; index < 2000; index += 1) {
      const currency = random.pick(CURRENCY_CODES);
      const exponent = exponentOf(currency);
      const text = `${random.int(0, 999)}.${"7".repeat(exponent + random.int(1, 3))}`;
      expect(parseDecimalString(text, currency), text).toEqual({
        ok: false,
        reason: "too_many_decimals",
      });
    }
  });
});
