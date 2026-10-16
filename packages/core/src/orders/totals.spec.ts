import { describe, expect, it } from "vitest";
import { deepFreeze } from "../catalog/test-support.js";
import type { SupportedCurrency } from "../pricing/currency.js";
import { MAX_AMOUNT } from "../pricing/limits.js";
import type { Money } from "../pricing/money.js";
import { computeOrderTotals } from "./totals.js";
import type { TotalsAdjustment, TotalsLine } from "./totals.js";

const money = (amount: number, currency: SupportedCurrency = "UAH"): Money => ({
  amount,
  currency,
});
const lineOf = (amount: number, currency: SupportedCurrency = "UAH"): TotalsLine => ({
  lineTotal: money(amount, currency),
});
const adjustment = (
  kind: string,
  amount: number,
  includedInPrice = false,
  currency: SupportedCurrency = "UAH",
): TotalsAdjustment => ({ kind, amount: money(amount, currency), includedInPrice });

function compute(lines: TotalsLine[], adjustments: TotalsAdjustment[] = []) {
  return computeOrderTotals(deepFreeze(lines), deepFreeze(adjustments));
}

function totalsOf(lines: TotalsLine[], adjustments: TotalsAdjustment[] = []) {
  const result = compute(lines, adjustments);
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  }
  const { totals } = result;
  return {
    subtotal: totals.subtotal.amount,
    shipping: totals.shippingTotal.amount,
    discount: totals.discountTotal.amount,
    tax: totals.taxTotal.amount,
    total: totals.total.amount,
    currency: totals.total.currency,
  };
}

describe("computeOrderTotals without adjustments", () => {
  it("the total of an order without adjustments is the subtotal", () => {
    expect(totalsOf([lineOf(1000), lineOf(2500), lineOf(0)])).toEqual({
      subtotal: 3500,
      shipping: 0,
      discount: 0,
      tax: 0,
      total: 3500,
      currency: "UAH",
    });
  });

  it("works for currencies with other exponents", () => {
    expect(totalsOf([lineOf(5, "JPY"), lineOf(7, "JPY")]).currency).toBe("JPY");
    expect(totalsOf([lineOf(1999, "KWD")], [adjustment("shipping", 1, false, "KWD")]).total).toBe(
      2000,
    );
  });

  it("refuses an order without lines", () => {
    expect(compute([])).toEqual({ ok: false, reason: "no_lines" });
    expect(compute([], [adjustment("shipping", 100)])).toEqual({ ok: false, reason: "no_lines" });
  });

  it("allows a single line of exactly MAX_AMOUNT", () => {
    expect(totalsOf([lineOf(MAX_AMOUNT)]).total).toBe(MAX_AMOUNT);
  });
});

describe("computeOrderTotals with adjustments", () => {
  it("adds shipping, tax and plugin kinds and subtracts discounts", () => {
    expect(
      totalsOf(
        [lineOf(10_000)],
        [
          adjustment("shipping", 500),
          adjustment("tax", 100),
          adjustment("discount", -300),
          adjustment("gift_wrap", 50),
          adjustment("loyalty_credit", -25),
        ],
      ),
    ).toEqual({
      subtotal: 10_000,
      shipping: 500,
      discount: -300,
      tax: 100,
      total: 10_325,
      currency: "UAH",
    });
  });

  it("sums several adjustments of one kind", () => {
    expect(
      totalsOf(
        [lineOf(1000)],
        [adjustment("discount", -100), adjustment("discount", -50), adjustment("shipping", 10)],
      ),
    ).toMatchObject({ discount: -150, shipping: 10, total: 860 });
  });

  it("reports an adjustment that is included in the price in its kind total but does not add it to the total", () => {
    expect(
      totalsOf([lineOf(12_000)], [adjustment("tax", 2000, true), adjustment("shipping", 300)]),
    ).toEqual({
      subtotal: 12_000,
      shipping: 300,
      discount: 0,
      tax: 2000,
      total: 12_300,
      currency: "UAH",
    });
    expect(totalsOf([lineOf(100)], [adjustment("shipping", 40, true)])).toMatchObject({
      shipping: 40,
      total: 100,
    });
    expect(totalsOf([lineOf(100)], [adjustment("discount", -30, true)])).toMatchObject({
      discount: -30,
      total: 100,
    });
  });

  it("an included plugin adjustment changes nothing, a plugin adjustment that is not included changes the total only", () => {
    expect(totalsOf([lineOf(100)], [adjustment("gift_wrap", 40, true)])).toMatchObject({
      shipping: 0,
      discount: 0,
      tax: 0,
      total: 100,
    });
    expect(totalsOf([lineOf(100)], [adjustment("gift_wrap", 40)])).toMatchObject({
      shipping: 0,
      discount: 0,
      tax: 0,
      total: 140,
    });
  });

  it("a total of exactly zero is allowed, a negative one is refused", () => {
    expect(totalsOf([lineOf(500)], [adjustment("discount", -500)]).total).toBe(0);
    expect(compute([lineOf(500)], [adjustment("discount", -501)])).toEqual({
      ok: false,
      reason: "negative_total",
    });
    expect(compute([lineOf(0)], [adjustment("loyalty_credit", -1)])).toEqual({
      ok: false,
      reason: "negative_total",
    });
  });

  it("a discount that is included in the price does not make the total negative", () => {
    expect(totalsOf([lineOf(100)], [adjustment("discount", -500, true)]).total).toBe(100);
  });

  it("never returns negative zero", () => {
    const result = compute([lineOf(0)], [adjustment("discount", 0)]);
    if (!result.ok) throw new Error("expected ok");
    for (const value of Object.values(result.totals)) {
      expect(Object.is(value.amount, 0)).toBe(true);
    }
    const net = compute([lineOf(500)], [adjustment("discount", -500)]);
    if (!net.ok) throw new Error("expected ok");
    expect(Object.is(net.totals.total.amount, 0)).toBe(true);
  });

  it("intermediate sums do not matter: MAX + MAX shipping - MAX discount fits", () => {
    expect(
      totalsOf(
        [lineOf(MAX_AMOUNT)],
        [adjustment("shipping", MAX_AMOUNT), adjustment("discount", -MAX_AMOUNT)],
      ).total,
    ).toBe(MAX_AMOUNT);
  });
});

describe("computeOrderTotals refusals", () => {
  it("refuses a discount that adds, and shipping or tax that subtract (invalid_adjustment with the position)", () => {
    expect(compute([lineOf(100)], [adjustment("discount", 1)])).toEqual({
      ok: false,
      reason: "invalid_adjustment",
      index: 0,
    });
    expect(compute([lineOf(100)], [adjustment("shipping", 5), adjustment("shipping", -1)])).toEqual(
      {
        ok: false,
        reason: "invalid_adjustment",
        index: 1,
      },
    );
    expect(compute([lineOf(100)], [adjustment("tax", -1)])).toEqual({
      ok: false,
      reason: "invalid_adjustment",
      index: 0,
    });
  });

  it("refuses a kind that is not a code", () => {
    for (const kind of ["", "Shipping", "1abc", "a-b", "a b", "x".repeat(65), "__proto__"]) {
      expect(compute([lineOf(100)], [adjustment(kind, 1)]), kind).toEqual({
        ok: false,
        reason: "invalid_adjustment",
        index: 0,
      });
    }
    expect(compute([lineOf(100)], [adjustment("x".repeat(64), 1)]).ok).toBe(true);
  });

  it("refuses mixed currencies in lines or adjustments", () => {
    expect(compute([lineOf(1), lineOf(1, "USD")])).toEqual({
      ok: false,
      reason: "currency_mismatch",
    });
    expect(compute([lineOf(1)], [adjustment("shipping", 1, false, "USD")])).toEqual({
      ok: false,
      reason: "currency_mismatch",
    });
  });

  it("checks currencies before the other rules", () => {
    expect(compute([lineOf(1)], [adjustment("discount", 5, false, "USD")])).toEqual({
      ok: false,
      reason: "currency_mismatch",
    });
  });

  it("refuses a subtotal above MAX_AMOUNT", () => {
    expect(compute([lineOf(MAX_AMOUNT), lineOf(1)])).toEqual({
      ok: false,
      reason: "subtotal_out_of_range",
    });
    expect(compute([lineOf(MAX_AMOUNT), lineOf(MAX_AMOUNT)])).toEqual({
      ok: false,
      reason: "subtotal_out_of_range",
    });
  });

  it("refuses adjustment sums that do not fit", () => {
    expect(
      compute([lineOf(1)], [adjustment("shipping", MAX_AMOUNT), adjustment("shipping", 1)]),
    ).toEqual({ ok: false, reason: "adjustments_out_of_range" });
    expect(
      compute([lineOf(1)], [adjustment("discount", -MAX_AMOUNT), adjustment("discount", -1)]),
    ).toEqual({ ok: false, reason: "adjustments_out_of_range" });
    expect(
      compute([lineOf(1)], [adjustment("gift_wrap", MAX_AMOUNT), adjustment("other", 1)]),
    ).toEqual({ ok: false, reason: "adjustments_out_of_range" });
    // Included adjustments still count in their kind total, and that must fit too.
    expect(
      compute([lineOf(1)], [adjustment("tax", MAX_AMOUNT, true), adjustment("tax", 1, true)]),
    ).toEqual({ ok: false, reason: "adjustments_out_of_range" });
  });

  it("refuses a total above MAX_AMOUNT", () => {
    expect(compute([lineOf(MAX_AMOUNT)], [adjustment("shipping", 1)])).toEqual({
      ok: false,
      reason: "total_out_of_range",
    });
  });

  it("treats corrupt lines and adjustments as bugs (RangeError)", () => {
    expect(() => compute([lineOf(-1)])).toThrow(RangeError);
    expect(() => compute([lineOf(1.5)])).toThrow(RangeError);
    expect(() => compute([lineOf(MAX_AMOUNT + 1)])).toThrow(RangeError);
    expect(() =>
      compute([{ lineTotal: { amount: 1, currency: "XXX" } } as unknown as TotalsLine]),
    ).toThrow(RangeError);
    expect(() =>
      compute(
        [lineOf(1)],
        [{ kind: "tax", amount: null, includedInPrice: false } as unknown as TotalsAdjustment],
      ),
    ).toThrow(RangeError);
    expect(() =>
      compute(
        [lineOf(1)],
        [{ kind: "tax", amount: money(1), includedInPrice: "no" } as unknown as TotalsAdjustment],
      ),
    ).toThrow(RangeError);
    expect(() => compute([lineOf(1)], [adjustment("tax", MAX_AMOUNT + 1)])).toThrow(RangeError);
  });

  it("does not mutate its input and freezes its output", () => {
    const lines = deepFreeze([lineOf(1000)]);
    const adjustments = deepFreeze([adjustment("shipping", 10)]);
    const result = computeOrderTotals(lines, adjustments);
    if (!result.ok) throw new Error("expected ok");
    expect(Object.isFrozen(result.totals)).toBe(true);
    for (const value of Object.values(result.totals)) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });
});
