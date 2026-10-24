import { describe, expect, it } from "vitest";
import { deepFreeze } from "../catalog/test-support.js";
import type { SupportedCurrency } from "../pricing/currency.js";
import { MAX_AMOUNT } from "../pricing/limits.js";
import type { Money } from "../pricing/money.js";
import { SHIPPING_LIMITS } from "./limits.js";
import { decideShippingPrice, validateShippingPricing } from "./pricing.js";
import type { ShippingPricingError } from "./pricing.js";

const money = (amount: number, currency: SupportedCurrency = "UAH"): Money => ({
  amount,
  currency,
});

function errorsOf(value: unknown): readonly ShippingPricingError[] {
  const result = validateShippingPricing(deepFreeze(value));
  if (result.ok) {
    throw new Error(`expected errors, got ${JSON.stringify(result)}`);
  }
  return result.errors;
}

function pricingOf(value: unknown) {
  const result = validateShippingPricing(deepFreeze(value));
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  }
  return result.pricing;
}

/** The charged amount for a subtotal in `currency`; fails the test on a refusal. */
function priceFor(pricing: unknown, subtotal: number, currency: SupportedCurrency = "UAH"): number {
  const result = decideShippingPrice(deepFreeze(pricing), {
    subtotal: money(subtotal, currency),
    currency,
  });
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  }
  expect(result.price.currency).toBe(currency);
  return result.price.amount;
}

const tiers = (...pairs: [number, number][]) => ({
  type: "tiers",
  tiers: pairs.map(([fromSubtotal, amount]) => ({ fromSubtotal, amount })),
});

describe("validateShippingPricing: shape", () => {
  it.each([null, undefined, [], "flat", 5, true])("refuses %j as not an object", (value) => {
    expect(errorsOf(value)).toEqual([{ field: "", reason: "not_an_object" }]);
  });

  it("requires a type", () => {
    expect(errorsOf({ amount: 100 })).toEqual([{ field: "type", reason: "required" }]);
  });

  it.each(["percent", "FLAT", "", 5, null, "__proto__", "toString"])(
    "refuses the type %j",
    (type) => {
      expect(errorsOf({ type, amount: 100 })).toEqual([{ field: "type", reason: "unknown_type" }]);
    },
  );

  it("refuses fields the type does not have, a currency included (the method holds it)", () => {
    expect(errorsOf({ type: "flat", amount: 100, currency: "UAH" })).toEqual([
      { field: "currency", reason: "unknown_field" },
    ]);
    expect(errorsOf({ type: "carrier_on_delivery", amount: 0 })).toEqual([
      { field: "amount", reason: "unknown_field" },
    ]);
    expect(errorsOf({ type: "flat", amount: 100, freeFrom: 5 })).toEqual([
      { field: "freeFrom", reason: "unknown_field" },
    ]);
  });

  it("refuses an own __proto__ key from parsed JSON", () => {
    const parsed: unknown = JSON.parse('{"type":"flat","amount":1,"__proto__":{"amount":2}}');
    expect(errorsOf(parsed)).toEqual([{ field: "__proto__", reason: "unknown_field" }]);
  });

  it("reports every error at once", () => {
    expect(errorsOf({ type: "free_over", amount: -1, extra: true })).toEqual([
      { field: "extra", reason: "unknown_field" },
      { field: "amount", reason: "out_of_range" },
      { field: "freeFrom", reason: "required" },
    ]);
  });
});

describe("validateShippingPricing: amounts", () => {
  it("accepts 0 and MAX_AMOUNT", () => {
    expect(pricingOf({ type: "flat", amount: 0 })).toEqual({ type: "flat", amount: 0 });
    expect(pricingOf({ type: "flat", amount: MAX_AMOUNT })).toEqual({
      type: "flat",
      amount: MAX_AMOUNT,
    });
  });

  it("refuses a negative amount and one above MAX_AMOUNT", () => {
    expect(errorsOf({ type: "flat", amount: -1 })).toEqual([
      { field: "amount", reason: "out_of_range" },
    ]);
    expect(errorsOf({ type: "flat", amount: MAX_AMOUNT + 1 })).toEqual([
      { field: "amount", reason: "out_of_range" },
    ]);
    expect(errorsOf({ type: "flat", amount: Number.MAX_SAFE_INTEGER + 2 })).toEqual([
      { field: "amount", reason: "out_of_range" },
    ]);
  });

  it.each([1.5, 0.1, "100", "1.00", Number.NaN, Number.POSITIVE_INFINITY, null, true, {}, []])(
    "refuses the amount %j as not an integer of minor units",
    (amount) => {
      expect(errorsOf({ type: "flat", amount })).toEqual([
        { field: "amount", reason: "not_an_integer" },
      ]);
    },
  );

  it("requires the amount", () => {
    expect(errorsOf({ type: "flat" })).toEqual([{ field: "amount", reason: "required" }]);
  });

  it("turns -0 into 0", () => {
    const pricing = pricingOf({ type: "flat", amount: -0 });
    expect(pricing.type === "flat" && Object.is(pricing.amount, 0)).toBe(true);
  });

  it("checks freeFrom like an amount and accepts a zero threshold", () => {
    expect(pricingOf({ type: "free_over", amount: 5000, freeFrom: 0 })).toEqual({
      type: "free_over",
      amount: 5000,
      freeFrom: 0,
    });
    expect(errorsOf({ type: "free_over", amount: 5000, freeFrom: MAX_AMOUNT + 1 })).toEqual([
      { field: "freeFrom", reason: "out_of_range" },
    ]);
    expect(errorsOf({ type: "free_over", amount: 5000, freeFrom: 99.5 })).toEqual([
      { field: "freeFrom", reason: "not_an_integer" },
    ]);
  });

  it("accepts carrier_on_delivery with no other field", () => {
    expect(pricingOf({ type: "carrier_on_delivery" })).toEqual({ type: "carrier_on_delivery" });
  });

  it("returns a frozen copy, not the input", () => {
    const input = { type: "tiers", tiers: [{ fromSubtotal: 0, amount: 100 }] };
    const pricing = pricingOf(input);
    expect(pricing).not.toBe(input);
    expect(Object.isFrozen(pricing)).toBe(true);
    if (pricing.type !== "tiers") {
      expect.unreachable();
    }
    expect(pricing.tiers).not.toBe(input.tiers);
    expect(Object.isFrozen(pricing.tiers)).toBe(true);
    expect(Object.isFrozen(pricing.tiers[0])).toBe(true);
  });
});

describe("validateShippingPricing: tiers", () => {
  it("accepts tiers sorted ascending that start at 0", () => {
    expect(pricingOf(tiers([0, 5000], [100_000, 2500], [200_000, 0]))).toEqual(
      tiers([0, 5000], [100_000, 2500], [200_000, 0]),
    );
  });

  it("requires a list", () => {
    expect(errorsOf({ type: "tiers" })).toEqual([{ field: "tiers", reason: "required" }]);
    expect(errorsOf({ type: "tiers", tiers: { 0: { fromSubtotal: 0, amount: 1 } } })).toEqual([
      { field: "tiers", reason: "not_an_array" },
    ]);
  });

  it("refuses an empty list", () => {
    expect(errorsOf({ type: "tiers", tiers: [] })).toEqual([
      { field: "tiers", reason: "no_tiers" },
    ]);
  });

  it(`accepts ${SHIPPING_LIMITS.maxTiers} tiers and refuses one more`, () => {
    const pairs = (count: number) =>
      Array.from({ length: count }, (_, index): [number, number] => [index * 1000, 100]);
    expect(pricingOf(tiers(...pairs(SHIPPING_LIMITS.maxTiers))).type).toBe("tiers");
    expect(errorsOf(tiers(...pairs(SHIPPING_LIMITS.maxTiers + 1)))).toEqual([
      { field: "tiers", reason: "too_many_tiers" },
    ]);
  });

  it("refuses a first tier that does not start at 0 (every subtotal must have a tier)", () => {
    expect(errorsOf(tiers([1, 5000], [100_000, 0]))).toEqual([
      { field: "tiers.0.fromSubtotal", reason: "first_tier_not_zero" },
    ]);
  });

  it("refuses unsorted tiers", () => {
    expect(errorsOf(tiers([0, 5000], [200_000, 0], [100_000, 2500]))).toEqual([
      { field: "tiers.2.fromSubtotal", reason: "tiers_not_sorted" },
    ]);
  });

  it("refuses a duplicate threshold", () => {
    expect(errorsOf(tiers([0, 5000], [100_000, 2500], [100_000, 0]))).toEqual([
      { field: "tiers.2.fromSubtotal", reason: "duplicate_tier" },
    ]);
  });

  it("checks each tier's fields and reports them by position", () => {
    expect(
      errorsOf({
        type: "tiers",
        tiers: [
          { fromSubtotal: 0, amount: -5 },
          "x",
          { fromSubtotal: 10, amount: 1, label: "a" },
          { amount: 1 },
          { fromSubtotal: 1.5, amount: MAX_AMOUNT + 1 },
        ],
      }),
    ).toEqual([
      { field: "tiers.0.amount", reason: "out_of_range" },
      { field: "tiers.1", reason: "not_an_object" },
      { field: "tiers.2.label", reason: "unknown_field" },
      { field: "tiers.3.fromSubtotal", reason: "required" },
      { field: "tiers.4.fromSubtotal", reason: "not_an_integer" },
      { field: "tiers.4.amount", reason: "out_of_range" },
    ]);
  });

  it("checks the order only when every tier is well formed", () => {
    expect(
      errorsOf({
        type: "tiers",
        tiers: [
          { fromSubtotal: 5, amount: 1 },
          { fromSubtotal: 1, amount: "1" },
        ],
      }),
    ).toEqual([{ field: "tiers.1.amount", reason: "not_an_integer" }]);
  });
});

describe("decideShippingPrice: flat", () => {
  it("charges the amount whatever the subtotal, paid by the shop's charge", () => {
    const result = decideShippingPrice(
      { type: "flat", amount: 5000 },
      { subtotal: money(123), currency: "UAH" },
    );
    expect(result).toEqual({ ok: true, price: money(5000), payer: "shop_charge" });
    expect(priceFor({ type: "flat", amount: 5000 }, 0)).toBe(5000);
    expect(priceFor({ type: "flat", amount: 5000 }, MAX_AMOUNT)).toBe(5000);
  });

  it("charges 0 and MAX_AMOUNT exactly", () => {
    expect(priceFor({ type: "flat", amount: 0 }, 100)).toBe(0);
    expect(priceFor({ type: "flat", amount: MAX_AMOUNT }, 100)).toBe(MAX_AMOUNT);
  });

  it("never returns -0", () => {
    expect(Object.is(priceFor({ type: "flat", amount: -0 }, 100), 0)).toBe(true);
  });
});

describe("decideShippingPrice: free_over", () => {
  const pricing = { type: "free_over", amount: 7000, freeFrom: 150_000 };

  it("is free at exactly the threshold", () => {
    expect(priceFor(pricing, 150_000)).toBe(0);
  });

  it("charges one minor unit below the threshold", () => {
    expect(priceFor(pricing, 149_999)).toBe(7000);
  });

  it("is free above the threshold and charges at a zero subtotal", () => {
    expect(priceFor(pricing, 150_001)).toBe(0);
    expect(priceFor(pricing, MAX_AMOUNT)).toBe(0);
    expect(priceFor(pricing, 0)).toBe(7000);
  });

  it("with a zero threshold is always free, also for a zero subtotal", () => {
    expect(priceFor({ type: "free_over", amount: 7000, freeFrom: 0 }, 0)).toBe(0);
    expect(priceFor({ type: "free_over", amount: 7000, freeFrom: 0 }, 1)).toBe(0);
  });

  it("with a threshold of 1 charges only a zero subtotal", () => {
    expect(priceFor({ type: "free_over", amount: 7000, freeFrom: 1 }, 0)).toBe(7000);
    expect(priceFor({ type: "free_over", amount: 7000, freeFrom: 1 }, 1)).toBe(0);
  });

  it("with a threshold of MAX_AMOUNT is free only at MAX_AMOUNT", () => {
    const top = { type: "free_over", amount: 7000, freeFrom: MAX_AMOUNT };
    expect(priceFor(top, MAX_AMOUNT - 1)).toBe(7000);
    expect(priceFor(top, MAX_AMOUNT)).toBe(0);
  });

  it("is paid by the shop's charge", () => {
    const result = decideShippingPrice(pricing, { subtotal: money(1), currency: "UAH" });
    expect(result.ok && result.payer).toBe("shop_charge");
  });
});

describe("decideShippingPrice: tiers", () => {
  const table = tiers([0, 5000], [100_000, 2500], [200_000, 0]);

  it.each([
    [0, 5000],
    [1, 5000],
    [99_999, 5000],
    [100_000, 2500],
    [100_001, 2500],
    [199_999, 2500],
    [200_000, 0],
    [MAX_AMOUNT, 0],
  ])(
    "a subtotal of %i costs %i (the tier with the highest fromSubtotal <= subtotal)",
    (sub, cost) => {
      expect(priceFor(table, sub)).toBe(cost);
    },
  );

  it("a single tier at 0 applies to every subtotal", () => {
    expect(priceFor(tiers([0, 300]), 0)).toBe(300);
    expect(priceFor(tiers([0, 300]), MAX_AMOUNT)).toBe(300);
  });

  it("tiers need not get cheaper: a higher tier may cost more", () => {
    const rising = tiers([0, 100], [1000, 900]);
    expect(priceFor(rising, 999)).toBe(100);
    expect(priceFor(rising, 1000)).toBe(900);
  });

  it("a tier at MAX_AMOUNT applies only at MAX_AMOUNT", () => {
    const edge = tiers([0, 100], [MAX_AMOUNT, 1]);
    expect(priceFor(edge, MAX_AMOUNT - 1)).toBe(100);
    expect(priceFor(edge, MAX_AMOUNT)).toBe(1);
  });

  it("matches an independent reference on seeded random tables and subtotals", () => {
    // Park-Miller generator: reproducible, no Math.random.
    let seed = 20_261_024;
    const next = (bound: number): number => {
      seed = (seed * 48_271) % 2_147_483_647;
      return seed % bound;
    };
    for (let round = 0; round < 3000; round += 1) {
      const count = 1 + next(SHIPPING_LIMITS.maxTiers);
      const thresholds = new Set<number>([0]);
      while (thresholds.size < count) {
        thresholds.add(1 + next(1_000_000));
      }
      const sorted = [...thresholds].sort((a, b) => a - b);
      const pairs = sorted.map((from): [number, number] => [from, next(100_000)]);
      const subtotal = next(4) === 0 ? (sorted[next(sorted.length)] ?? 0) : next(1_200_000);
      const expected = pairs.filter(([from]) => from <= subtotal).at(-1)?.[1];
      expect(priceFor(tiers(...pairs), subtotal)).toBe(expected);
    }
  });
});

describe("decideShippingPrice: carrier_on_delivery", () => {
  it("charges 0 and the recipient pays the carrier", () => {
    expect(
      decideShippingPrice(
        { type: "carrier_on_delivery" },
        { subtotal: money(99_999), currency: "UAH" },
      ),
    ).toEqual({ ok: true, price: money(0), payer: "recipient_on_delivery" });
  });
});

describe("decideShippingPrice: currencies", () => {
  it("works in minor units of JPY (exponent 0) without rounding", () => {
    expect(priceFor({ type: "flat", amount: 500 }, 3000, "JPY")).toBe(500);
    const free = { type: "free_over", amount: 800, freeFrom: 10_000 };
    expect(priceFor(free, 9999, "JPY")).toBe(800);
    expect(priceFor(free, 10_000, "JPY")).toBe(0);
  });

  it("works in minor units of KWD (exponent 3) without rounding", () => {
    expect(priceFor({ type: "flat", amount: 1250 }, 1, "KWD")).toBe(1250);
    const free = { type: "free_over", amount: 1250, freeFrom: 20_000 };
    expect(priceFor(free, 19_999, "KWD")).toBe(1250);
    expect(priceFor(free, 20_000, "KWD")).toBe(0);
    expect(priceFor(tiers([0, 1999], [5001, 1]), 5001, "KWD")).toBe(1);
  });

  it("refuses a subtotal in another currency than the method", () => {
    expect(
      decideShippingPrice({ type: "flat", amount: 100 }, { subtotal: money(5), currency: "USD" }),
    ).toEqual({ ok: false, reason: "currency_mismatch" });
    expect(
      decideShippingPrice(
        { type: "carrier_on_delivery" },
        { subtotal: money(5, "JPY"), currency: "UAH" },
      ),
    ).toEqual({ ok: false, reason: "currency_mismatch" });
  });

  it("throws for an unsupported method currency (configuration error)", () => {
    expect(() =>
      decideShippingPrice(
        { type: "flat", amount: 1 },
        { subtotal: money(5), currency: "XYZ" as SupportedCurrency },
      ),
    ).toThrow(RangeError);
  });
});

describe("decideShippingPrice: bad input", () => {
  it.each([
    tiers([0, 5000], [200_000, 0], [100_000, 2500]),
    tiers([0, 5000], [0, 2500]),
    tiers([10, 5000]),
    { type: "flat", amount: -1 },
    { type: "flat", amount: MAX_AMOUNT + 1 },
    { type: "flat", amount: 1.5 },
    { type: "percent", amount: 1 },
    { type: "flat", amount: 1, extra: 1 },
    null,
  ])("refuses stored pricing %j that the write rules refuse", (pricing) => {
    expect(decideShippingPrice(pricing, { subtotal: money(150_000), currency: "UAH" })).toEqual({
      ok: false,
      reason: "invalid_pricing",
    });
  });

  it.each([
    money(-1),
    money(1.5),
    money(MAX_AMOUNT + 1),
    { amount: 1, currency: "XYZ" },
    { amount: "1", currency: "UAH" },
    null,
  ])(
    "throws for a subtotal %j that is not valid, non-negative money (a caller bug)",
    (subtotal) => {
      expect(() =>
        decideShippingPrice(
          { type: "flat", amount: 1 },
          { subtotal: subtotal as Money, currency: "UAH" },
        ),
      ).toThrow(RangeError);
    },
  );

  it("returns a frozen decision and price", () => {
    const result = decideShippingPrice(
      { type: "flat", amount: 1 },
      { subtotal: money(5), currency: "UAH" },
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.ok && Object.isFrozen(result.price)).toBe(true);
  });
});
