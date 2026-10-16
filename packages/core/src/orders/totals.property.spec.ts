import { describe, expect, it } from "vitest";
import { deepFreeze } from "../catalog/test-support.js";
import { CURRENCY_CODES } from "../pricing/currency.js";
import type { SupportedCurrency } from "../pricing/currency.js";
import { MAX_AMOUNT } from "../pricing/limits.js";
import { computeOrderTotals } from "./totals.js";
import type { TotalsAdjustment, TotalsLine } from "./totals.js";

/*
 * Property-style test of the order totals. Everything random comes from a seeded generator (never Math.random), so a
 * failure reproduces exactly. The expected values come from the reference below, written differently from the
 * production code: exact BigInt sums grouped in one pass, no money helpers, kind codes checked character by character.
 * The reference states the rules of the plan in the order the production code checks them.
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

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** A non-negative amount: mostly small, sometimes huge, sometimes at the edge of the range. */
  magnitude(scale: "small" | "mixed"): number {
    if (scale === "small") {
      return this.int(0, 1_000_000);
    }
    switch (this.int(0, 6)) {
      case 0:
        return this.int(0, 99);
      case 1:
        return this.int(0, 1_000_000);
      case 2:
        return this.int(0, 100_000_000_000);
      case 3:
        return MAX_AMOUNT - this.int(0, 3);
      case 4:
        return Math.floor(MAX_AMOUNT / 2) + this.int(-2, 2);
      case 5:
        return this.int(MAX_AMOUNT - 1_000, MAX_AMOUNT);
      default:
        return this.int(0, MAX_AMOUNT);
    }
  }
}

const VALID_KINDS = ["shipping", "discount", "tax", "gift_wrap", "loyalty_credit", "a", "x9_"];
const INVALID_KINDS = ["", "Shipping", "1abc", "a-b", "a b", "x".repeat(65), "_tax"];

interface Case {
  readonly lines: TotalsLine[];
  readonly adjustments: TotalsAdjustment[];
}

type Expected =
  | {
      readonly ok: true;
      readonly subtotal: bigint;
      readonly shipping: bigint;
      readonly discount: bigint;
      readonly tax: bigint;
      readonly total: bigint;
    }
  | { readonly ok: false; readonly reason: string; readonly index?: number };

const LIMIT = BigInt(MAX_AMOUNT);
const outside = (value: bigint): boolean => value > LIMIT || value < -LIMIT;

function kindIsCode(kind: string): boolean {
  if (kind.length < 1 || kind.length > 64) return false;
  for (let position = 0; position < kind.length; position += 1) {
    const code = kind.charCodeAt(position);
    const isLetter = code >= 97 && code <= 122;
    const isDigit = code >= 48 && code <= 57;
    if (position === 0 ? !isLetter : !(isLetter || isDigit || code === 95)) return false;
  }
  return true;
}

function reference(testCase: Case): Expected {
  const { lines, adjustments } = testCase;
  const first = lines[0];
  if (first === undefined) return { ok: false, reason: "no_lines" };
  const currency = first.lineTotal.currency;
  if (
    lines.some((line) => line.lineTotal.currency !== currency) ||
    adjustments.some((entry) => entry.amount.currency !== currency)
  ) {
    return { ok: false, reason: "currency_mismatch" };
  }
  for (const [index, entry] of adjustments.entries()) {
    const amount = entry.amount.amount;
    const wrongSign =
      (entry.kind === "discount" && amount > 0) ||
      ((entry.kind === "shipping" || entry.kind === "tax") && amount < 0);
    if (!kindIsCode(entry.kind) || wrongSign) {
      return { ok: false, reason: "invalid_adjustment", index };
    }
  }
  let subtotal = 0n;
  for (const line of lines) subtotal += BigInt(line.lineTotal.amount);
  if (outside(subtotal)) return { ok: false, reason: "subtotal_out_of_range" };

  const byKind = new Map<string, bigint>();
  let positives = 0n;
  let negatives = 0n;
  for (const entry of adjustments) {
    const amount = BigInt(entry.amount.amount);
    byKind.set(entry.kind, (byKind.get(entry.kind) ?? 0n) + amount);
    if (!entry.includedInPrice) {
      if (amount > 0n) positives += amount;
      if (amount < 0n) negatives += amount;
    }
  }
  const shipping = byKind.get("shipping") ?? 0n;
  const discount = byKind.get("discount") ?? 0n;
  const tax = byKind.get("tax") ?? 0n;
  if ([shipping, discount, tax, positives, negatives].some(outside)) {
    return { ok: false, reason: "adjustments_out_of_range" };
  }
  const total = subtotal + positives + negatives;
  if (total > LIMIT) return { ok: false, reason: "total_out_of_range" };
  if (total < 0n) return { ok: false, reason: "negative_total" };
  return { ok: true, subtotal, shipping, discount, tax, total };
}

function generate(random: Random): Case {
  const scale = random.chance(0.6) ? "small" : "mixed";
  const currency: SupportedCurrency = random.pick(CURRENCY_CODES);
  const lineCount = random.chance(0.02) ? 0 : random.int(1, 6);
  const lines: TotalsLine[] = [];
  for (let index = 0; index < lineCount; index += 1) {
    const lineCurrency = random.chance(0.01) ? random.pick(CURRENCY_CODES) : currency;
    lines.push({ lineTotal: { amount: random.magnitude(scale), currency: lineCurrency } });
  }
  const adjustmentCount = random.int(0, 6);
  const adjustments: TotalsAdjustment[] = [];
  for (let index = 0; index < adjustmentCount; index += 1) {
    const kind = random.chance(0.03) ? random.pick(INVALID_KINDS) : random.pick(VALID_KINDS);
    // Mostly valid signs, so the interesting arithmetic is reached; sometimes the wrong sign.
    let sign: 1 | -1 = kind === "discount" || kind === "loyalty_credit" ? -1 : 1;
    if (random.chance(0.05)) sign = sign === 1 ? -1 : 1;
    if (kind === "a" || kind === "x9_" || kind === "gift_wrap") sign = random.chance(0.5) ? 1 : -1;
    const magnitude = random.magnitude(scale);
    const adjustmentCurrency = random.chance(0.01) ? random.pick(CURRENCY_CODES) : currency;
    adjustments.push({
      kind,
      amount: { amount: magnitude === 0 ? 0 : sign * magnitude, currency: adjustmentCurrency },
      includedInPrice: random.chance(0.25),
    });
  }
  return { lines, adjustments };
}

describe("computeOrderTotals against an independent BigInt reference", () => {
  const CASES = 30_000;

  it(`agrees on ${String(CASES)} seeded random orders, including every refusal`, () => {
    const random = new Random(0x0a11d0c5);
    const seen = new Map<string, number>();
    for (let iteration = 0; iteration < CASES; iteration += 1) {
      const testCase = generate(random);
      const expected = reference(testCase);
      const actual = computeOrderTotals(
        deepFreeze(testCase.lines),
        deepFreeze(testCase.adjustments),
      );
      const label = `case ${String(iteration)} ${JSON.stringify(testCase)}`;
      seen.set(
        expected.ok ? "ok" : expected.reason,
        (seen.get(expected.ok ? "ok" : expected.reason) ?? 0) + 1,
      );
      if (expected.ok) {
        if (!actual.ok) throw new Error(`${label}: refused with ${actual.reason}`);
        const { totals } = actual;
        expect(BigInt(totals.subtotal.amount), label).toBe(expected.subtotal);
        expect(BigInt(totals.shippingTotal.amount), label).toBe(expected.shipping);
        expect(BigInt(totals.discountTotal.amount), label).toBe(expected.discount);
        expect(BigInt(totals.taxTotal.amount), label).toBe(expected.tax);
        expect(BigInt(totals.total.amount), label).toBe(expected.total);
        for (const value of Object.values(totals)) {
          expect(Object.is(value.amount, -0), label).toBe(false);
          expect(value.currency, label).toBe(testCase.lines[0]?.lineTotal.currency);
        }
      } else {
        if (actual.ok) throw new Error(`${label}: accepted, expected ${expected.reason}`);
        expect(actual.reason, label).toBe(expected.reason);
        if (expected.reason === "invalid_adjustment") {
          expect("index" in actual ? actual.index : undefined, label).toBe(expected.index);
        }
      }
    }
    // The generator must reach every outcome, or the test proves less than it says.
    for (const outcome of [
      "ok",
      "no_lines",
      "currency_mismatch",
      "invalid_adjustment",
      "subtotal_out_of_range",
      "adjustments_out_of_range",
      "total_out_of_range",
      "negative_total",
    ]) {
      expect(seen.get(outcome) ?? 0, outcome).toBeGreaterThanOrEqual(20);
    }
    expect(seen.get("ok") ?? 0).toBeGreaterThan(CASES / 4);
  });

  it("the total always equals the subtotal plus the adjustments that are not in the price (exact, by construction)", () => {
    const random = new Random(0x5eed1234);
    let checked = 0;
    for (let iteration = 0; iteration < 5_000; iteration += 1) {
      const lines: TotalsLine[] = Array.from({ length: random.int(1, 5) }, () => ({
        lineTotal: { amount: random.int(0, 5_000_000), currency: "UAH" as const },
      }));
      const adjustments: TotalsAdjustment[] = Array.from({ length: random.int(0, 5) }, () => {
        const kind = random.pick(["shipping", "tax", "discount", "gift_wrap"]);
        const amount = random.int(0, 100_000) * (kind === "discount" ? -1 : 1);
        return {
          kind,
          amount: { amount: amount === 0 ? 0 : amount, currency: "UAH" as const },
          includedInPrice: random.chance(0.4),
        };
      });
      const result = computeOrderTotals(deepFreeze(lines), deepFreeze(adjustments));
      if (!result.ok) {
        expect(result.reason).toBe("negative_total");
        continue;
      }
      const expected =
        lines.reduce((sum, line) => sum + line.lineTotal.amount, 0) +
        adjustments.reduce(
          (sum, entry) => sum + (entry.includedInPrice ? 0 : entry.amount.amount),
          0,
        );
      expect(result.totals.total.amount).toBe(expected);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(3_000);
  });
});
