import { describe, expect, it } from "vitest";
import { deepFreeze } from "../catalog/test-support.js";
import type { Availability } from "../inventory/availability.js";
import type { SupportedCurrency } from "../pricing/currency.js";
import { MAX_AMOUNT } from "../pricing/limits.js";
import type { Money } from "../pricing/money.js";
import type { Price } from "../pricing/price.js";
import { MAX_CART_LINES, MAX_LINE_QUANTITY } from "./limits.js";
import { priceCart } from "./pricing.js";
import type { PricedLineInput } from "./pricing.js";

const price = (
  amount: number,
  currency: SupportedCurrency = "UAH",
  compareAtAmount: number | null = null,
): Price => ({ amount, currency, compareAtAmount });
const money = (amount: number, currency: SupportedCurrency = "UAH"): Money => ({
  amount,
  currency,
});

interface LineOptions {
  readonly sellable?: boolean;
  readonly currentPrice?: Price | null;
  readonly availability?: Availability;
  readonly seen?: Money | null;
}

function input(variantId: string, quantity: number, options: LineOptions = {}): PricedLineInput {
  return deepFreeze({
    variantId,
    quantity,
    facts: {
      sellable: options.sellable ?? true,
      currentPrice: options.currentPrice === undefined ? price(1000) : options.currentPrice,
      availability: options.availability ?? "in_stock",
      seen: options.seen === undefined ? null : options.seen,
    },
  });
}

function priced(lines: readonly PricedLineInput[], currency: SupportedCurrency = "UAH") {
  const result = priceCart(currency, deepFreeze([...lines]));
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  }
  return result;
}

describe("priceCart totals", () => {
  it("prices each line with the current unit price and sums the subtotal", () => {
    const result = priced([
      input("a", 2, { currentPrice: price(1250, "UAH", 1500) }),
      input("b", 3, { currentPrice: price(399) }),
    ]);
    expect(result.lines[0]).toMatchObject({
      variantId: "a",
      quantity: 2,
      unitPrice: { amount: 1250, currency: "UAH" },
      compareAtAmount: 1500,
      lineTotal: { amount: 2500, currency: "UAH" },
      notices: [],
    });
    expect(result.lines[1]).toMatchObject({
      unitPrice: { amount: 399, currency: "UAH" },
      compareAtAmount: null,
      lineTotal: { amount: 1197, currency: "UAH" },
    });
    expect(result.subtotal).toEqual({ amount: 3697, currency: "UAH" });
    expect(result.itemCount).toBe(5);
    expect(result.purchasable).toBe(true);
  });

  it("an empty cart is a zero subtotal in the cart currency, not purchasable", () => {
    const result = priced([], "JPY");
    expect(result).toMatchObject({
      lines: [],
      subtotal: { amount: 0, currency: "JPY" },
      itemCount: 0,
      purchasable: false,
    });
  });

  it("a free line is valid and the amounts are never negative zero", () => {
    const result = priced([input("a", 3, { currentPrice: price(0) })]);
    expect(Object.is(result.lines[0]?.lineTotal?.amount, 0)).toBe(true);
    expect(Object.is(result.subtotal.amount, 0)).toBe(true);
    expect(result.purchasable).toBe(true);
  });

  it("keeps the order of the lines", () => {
    const result = priced([input("z", 1), input("a", 1), input("m", 1)]);
    expect(result.lines.map((line) => line.variantId)).toEqual(["z", "a", "m"]);
  });

  it("sums a full cart exactly", () => {
    const lines = Array.from({ length: MAX_CART_LINES }, (_, index) =>
      input(`v${index}`, MAX_LINE_QUANTITY, { currentPrice: price(1_000_001 + index) }),
    );
    const result = priced(lines);
    const expected = lines.reduce(
      (sum, line) => sum + BigInt(line.facts.currentPrice?.amount ?? 0) * BigInt(line.quantity),
      0n,
    );
    expect(BigInt(result.subtotal.amount)).toBe(expected);
    expect(result.itemCount).toBe(MAX_CART_LINES * MAX_LINE_QUANTITY);
  });
});

describe("priceCart overflow is a refusal, never a clamp", () => {
  it("refuses 999 x MAX_AMOUNT", () => {
    const result = priceCart(
      "UAH",
      deepFreeze([input("a", 999, { currentPrice: price(MAX_AMOUNT) })]),
    );
    expect(result).toEqual({ ok: false, reason: "line_total_out_of_range", lineIndexes: [0] });
  });

  it("names every overflowing line, not only the first", () => {
    const result = priceCart(
      "UAH",
      deepFreeze([
        input("a", 2, { currentPrice: price(MAX_AMOUNT) }),
        input("b", 1),
        input("c", 999, { currentPrice: price(MAX_AMOUNT) }),
      ]),
    );
    expect(result).toEqual({ ok: false, reason: "line_total_out_of_range", lineIndexes: [0, 2] });
  });

  it("is exact at the edge of one line: 1001001001 x 999 fits, 1001001002 x 999 does not", () => {
    const fits = priced([input("a", 999, { currentPrice: price(1_001_001_001) })]);
    expect(fits.lines[0]?.lineTotal?.amount).toBe(999_999_999_999);
    expect(
      priceCart("UAH", deepFreeze([input("a", 999, { currentPrice: price(1_001_001_002) })])),
    ).toEqual({ ok: false, reason: "line_total_out_of_range", lineIndexes: [0] });
  });

  it("accepts a subtotal of exactly MAX_AMOUNT and refuses one unit more", () => {
    const half = MAX_AMOUNT / 2;
    const exact = priced([
      input("a", 1, { currentPrice: price(half) }),
      input("b", 1, { currentPrice: price(half) }),
    ]);
    expect(exact.subtotal.amount).toBe(MAX_AMOUNT);
    expect(
      priceCart(
        "UAH",
        deepFreeze([
          input("a", 1, { currentPrice: price(half) }),
          input("b", 1, { currentPrice: price(half) }),
          input("c", 1, { currentPrice: price(1) }),
        ]),
      ),
    ).toEqual({ ok: false, reason: "subtotal_out_of_range" });
  });

  it("two lines of MAX_AMOUNT overflow the subtotal", () => {
    expect(
      priceCart(
        "UAH",
        deepFreeze([
          input("a", 1, { currentPrice: price(MAX_AMOUNT) }),
          input("b", 1, { currentPrice: price(MAX_AMOUNT) }),
        ]),
      ),
    ).toEqual({ ok: false, reason: "subtotal_out_of_range" });
  });

  it("reports an overflowing line before a subtotal overflow", () => {
    const result = priceCart(
      "UAH",
      deepFreeze([
        input("a", 1, { currentPrice: price(MAX_AMOUNT) }),
        input("b", 1, { currentPrice: price(MAX_AMOUNT) }),
        input("c", 999, { currentPrice: price(MAX_AMOUNT) }),
      ]),
    );
    expect(result).toEqual({ ok: false, reason: "line_total_out_of_range", lineIndexes: [2] });
  });

  it("an unavailable line can not overflow anything: it is not priced", () => {
    const result = priced([
      input("a", 999, { sellable: false, currentPrice: price(MAX_AMOUNT) }),
      input("b", 1),
    ]);
    expect(result.subtotal.amount).toBe(1000);
  });
});

describe("priceCart notices", () => {
  it("says price_changed with the previous price when the seen price differs", () => {
    const result = priced([
      input("up", 1, { currentPrice: price(1200), seen: money(1000) }),
      input("down", 1, { currentPrice: price(800), seen: money(1000) }),
      input("same", 1, { currentPrice: price(1000), seen: money(1000) }),
      input("never", 1, { currentPrice: price(1000), seen: null }),
    ]);
    expect(result.lines[0]?.notices).toEqual([
      { code: "price_changed", previousAmount: { amount: 1000, currency: "UAH" } },
    ]);
    expect(result.lines[1]?.notices).toEqual([
      { code: "price_changed", previousAmount: { amount: 1000, currency: "UAH" } },
    ]);
    expect(result.lines[2]?.notices).toEqual([]);
    expect(result.lines[3]?.notices).toEqual([]);
    expect(result.purchasable).toBe(true);
  });

  it("a seen price in another currency is a price_changed (the shop currency was changed)", () => {
    const result = priced([input("a", 1, { currentPrice: price(1000), seen: money(1000, "USD") })]);
    expect(result.lines[0]?.notices).toEqual([
      { code: "price_changed", previousAmount: { amount: 1000, currency: "USD" } },
    ]);
    expect(result.subtotal).toEqual({ amount: 1000, currency: "UAH" });
  });

  it("a changed compare-at price alone is not a price change", () => {
    const result = priced([
      input("a", 1, { currentPrice: price(1000, "UAH", 2000), seen: money(1000) }),
    ]);
    expect(result.lines[0]?.notices).toEqual([]);
  });

  it("a variant that is not sellable is unavailable: kept, not priced, not in the subtotal, not purchasable", () => {
    const result = priced([
      input("gone", 2, {
        sellable: false,
        currentPrice: price(5000),
        seen: money(4000),
        availability: "out_of_stock",
      }),
      input("ok", 1),
    ]);
    expect(result.lines[0]).toEqual({
      variantId: "gone",
      quantity: 2,
      unitPrice: null,
      compareAtAmount: null,
      lineTotal: null,
      availability: "out_of_stock",
      notices: [{ code: "unavailable" }],
    });
    expect(result.subtotal).toEqual({ amount: 1000, currency: "UAH" });
    expect(result.itemCount).toBe(3);
    expect(result.purchasable).toBe(false);
  });

  it("a sellable variant without a price is unavailable too: nothing is ever charged without a price", () => {
    const result = priced([input("a", 1, { currentPrice: null })]);
    expect(result.lines[0]).toMatchObject({
      unitPrice: null,
      lineTotal: null,
      notices: [{ code: "unavailable" }],
    });
    expect(result.purchasable).toBe(false);
  });

  it("a price in another currency is never mixed in: the line is unavailable and left out", () => {
    const result = priced([
      input("usd", 2, { currentPrice: price(100, "USD") }),
      input("uah", 1, { currentPrice: price(700) }),
    ]);
    expect(result.lines[0]).toMatchObject({
      unitPrice: null,
      lineTotal: null,
      compareAtAmount: null,
      notices: [{ code: "unavailable" }],
    });
    expect(result.subtotal).toEqual({ amount: 700, currency: "UAH" });
    expect(result.purchasable).toBe(false);
  });

  it("says out_of_stock for a sellable line with no stock, which does not block purchasable", () => {
    const result = priced([input("a", 1, { availability: "out_of_stock" })]);
    expect(result.lines[0]?.notices).toEqual([{ code: "out_of_stock" }]);
    expect(result.lines[0]?.lineTotal).toEqual({ amount: 1000, currency: "UAH" });
    expect(result.purchasable).toBe(true);
  });

  it("lists notices in a fixed order: price_changed, then out_of_stock", () => {
    const result = priced([
      input("a", 1, { availability: "out_of_stock", seen: money(1), currentPrice: price(2) }),
    ]);
    expect(result.lines[0]?.notices.map((notice) => notice.code)).toEqual([
      "price_changed",
      "out_of_stock",
    ]);
  });

  it("passes low_stock and in_stock through without a notice", () => {
    const result = priced([
      input("a", 1, { availability: "low_stock" }),
      input("b", 1, { availability: "in_stock" }),
    ]);
    expect(result.lines.map((line) => [line.availability, line.notices.length])).toEqual([
      ["low_stock", 0],
      ["in_stock", 0],
    ]);
  });
});

describe("priceCart input and output hygiene", () => {
  it("does not mutate its input and freezes everything it returns", () => {
    const lines = deepFreeze([input("a", 2, { seen: money(900) }), input("b", 1)]);
    const before = JSON.stringify(lines);
    const result = priced(lines);
    expect(JSON.stringify(lines)).toBe(before);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.lines)).toBe(true);
    expect(Object.isFrozen(result.subtotal)).toBe(true);
    for (const line of result.lines) {
      expect(Object.isFrozen(line)).toBe(true);
      expect(Object.isFrozen(line.notices)).toBe(true);
      expect(Object.isFrozen(line.unitPrice)).toBe(true);
      expect(Object.isFrozen(line.lineTotal)).toBe(true);
    }
    const noticeLine = result.lines[0];
    expect(noticeLine?.notices[0] && Object.isFrozen(noticeLine.notices[0])).toBe(true);
  });

  it("treats corrupt facts as bugs (RangeError)", () => {
    const bad = (line: PricedLineInput) => () => priceCart("UAH", [line]);
    expect(bad(input("a", 0))).toThrow(RangeError);
    expect(bad(input("a", MAX_LINE_QUANTITY + 1))).toThrow(RangeError);
    expect(bad(input("a", 1.5))).toThrow(RangeError);
    expect(bad(input("", 1))).toThrow(RangeError);
    expect(bad(input("a", 1, { currentPrice: price(-1) }))).toThrow(RangeError);
    expect(bad(input("a", 1, { currentPrice: price(1.5) }))).toThrow(RangeError);
    expect(bad(input("a", 1, { currentPrice: price(2, "UAH", 2) }))).toThrow(RangeError);
    expect(bad(input("a", 1, { seen: money(-5) }))).toThrow(RangeError);
    expect(bad(input("a", 1, { availability: "plenty" as Availability }))).toThrow(RangeError);
    expect(bad(input("a", 1, { sellable: "yes" as unknown as boolean }))).toThrow(RangeError);
    expect(() => priceCart("XXX" as SupportedCurrency, [])).toThrow(RangeError);
  });

  it("treats duplicate variants and more than the line limit as bugs (RangeError)", () => {
    expect(() => priceCart("UAH", [input("a", 1), input("a", 1)])).toThrow(RangeError);
    const many = Array.from({ length: MAX_CART_LINES + 1 }, (_, index) => input(`v${index}`, 1));
    expect(() => priceCart("UAH", many)).toThrow(RangeError);
  });
});
