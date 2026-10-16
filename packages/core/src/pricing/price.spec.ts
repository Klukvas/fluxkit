import { describe, expect, it } from "vitest";
import { deepFreeze } from "../catalog/test-support.js";
import { MAX_AMOUNT } from "./limits.js";
import { pickSellablePrice, validatePrice } from "./price.js";

describe("validatePrice", () => {
  it("accepts a price without a compare-at amount", () => {
    expect(validatePrice({ amount: 1999, currency: "UAH" })).toEqual({
      ok: true,
      price: { amount: 1999, currency: "UAH", compareAtAmount: null },
    });
  });

  it("treats null and undefined compare-at as absent", () => {
    for (const compareAtAmount of [null, undefined]) {
      expect(validatePrice({ amount: 100, currency: "USD", compareAtAmount })).toEqual({
        ok: true,
        price: { amount: 100, currency: "USD", compareAtAmount: null },
      });
    }
  });

  it("accepts zero and the maximum amount", () => {
    expect(validatePrice({ amount: 0, currency: "UAH" }).ok).toBe(true);
    expect(validatePrice({ amount: MAX_AMOUNT, currency: "UAH" }).ok).toBe(true);
  });

  it("accepts compare-at strictly greater than the amount, up to the maximum", () => {
    expect(validatePrice({ amount: 100, currency: "UAH", compareAtAmount: 101 }).ok).toBe(true);
    expect(validatePrice({ amount: 0, currency: "UAH", compareAtAmount: MAX_AMOUNT }).ok).toBe(
      true,
    );
  });

  it("refuses compare-at equal to or below the amount", () => {
    expect(validatePrice({ amount: 100, currency: "UAH", compareAtAmount: 100 })).toEqual({
      ok: false,
      reason: "compare_at_not_greater",
    });
    expect(validatePrice({ amount: 100, currency: "UAH", compareAtAmount: 99 })).toEqual({
      ok: false,
      reason: "compare_at_not_greater",
    });
  });

  it("refuses a negative amount", () => {
    expect(validatePrice({ amount: -1, currency: "UAH" })).toEqual({
      ok: false,
      reason: "negative_amount",
    });
  });

  it("refuses amounts that are not integers in range", () => {
    expect(validatePrice({ amount: "10", currency: "UAH" })).toEqual({
      ok: false,
      reason: "not_a_number",
    });
    expect(validatePrice({ amount: Number.NaN, currency: "UAH" })).toEqual({
      ok: false,
      reason: "not_a_number",
    });
    expect(validatePrice({ amount: 10.5, currency: "UAH" })).toEqual({
      ok: false,
      reason: "not_an_integer",
    });
    expect(validatePrice({ amount: Number.POSITIVE_INFINITY, currency: "UAH" })).toEqual({
      ok: false,
      reason: "not_an_integer",
    });
    expect(validatePrice({ amount: MAX_AMOUNT + 1, currency: "UAH" })).toEqual({
      ok: false,
      reason: "amount_out_of_range",
    });
    expect(validatePrice({ currency: "UAH" })).toEqual({ ok: false, reason: "not_a_number" });
  });

  it("refuses an unsupported or malformed currency", () => {
    for (const currency of ["uah", "XXX", "", "__proto__", "toString", 980, null, undefined]) {
      expect(validatePrice({ amount: 1, currency })).toEqual({
        ok: false,
        reason: "unsupported_currency",
      });
    }
  });

  it("refuses an invalid compare-at amount with its own reasons", () => {
    expect(validatePrice({ amount: 1, currency: "UAH", compareAtAmount: "5" })).toEqual({
      ok: false,
      reason: "compare_at_not_a_number",
    });
    expect(validatePrice({ amount: 1, currency: "UAH", compareAtAmount: 5.5 })).toEqual({
      ok: false,
      reason: "compare_at_not_an_integer",
    });
    expect(validatePrice({ amount: 1, currency: "UAH", compareAtAmount: MAX_AMOUNT + 1 })).toEqual({
      ok: false,
      reason: "compare_at_out_of_range",
    });
    expect(validatePrice({ amount: 1, currency: "UAH", compareAtAmount: -5 })).toEqual({
      ok: false,
      reason: "compare_at_not_greater",
    });
  });

  it("refuses input that is not an object", () => {
    for (const input of [null, undefined, 5, "price", []]) {
      expect(validatePrice(input)).toEqual({ ok: false, reason: "not_an_object" });
    }
  });

  it("does not mutate its input and returns a frozen price", () => {
    const input = deepFreeze({ amount: 100, currency: "UAH", compareAtAmount: 200 });
    const result = validatePrice(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.isFrozen(result.price)).toBe(true);
    }
  });
});

describe("pickSellablePrice", () => {
  const uah = { amount: 1000, currency: "UAH", compareAtAmount: null } as const;
  const usd = { amount: 30, currency: "USD", compareAtAmount: 40 } as const;

  it("returns the price in the shop currency", () => {
    expect(pickSellablePrice(deepFreeze([usd, uah]), "UAH")).toEqual({ ok: true, price: uah });
  });

  it("never converts or chooses another currency", () => {
    expect(pickSellablePrice([usd], "UAH")).toEqual({
      ok: false,
      reason: "no_price_in_shop_currency",
    });
    expect(pickSellablePrice([], "UAH")).toEqual({
      ok: false,
      reason: "no_price_in_shop_currency",
    });
  });

  it("throws RangeError for an unsupported shop currency", () => {
    expect(() => pickSellablePrice([uah], "uah" as never)).toThrow(RangeError);
  });

  it("throws RangeError for corrupt stored data (duplicate or invalid price in the shop currency)", () => {
    expect(() => pickSellablePrice([uah, { ...uah, amount: 5 }], "UAH")).toThrow(RangeError);
    expect(() => pickSellablePrice([{ ...uah, amount: -1 }], "UAH")).toThrow(RangeError);
    expect(() => pickSellablePrice([{ ...uah, amount: 100, compareAtAmount: 100 }], "UAH")).toThrow(
      RangeError,
    );
  });
});
