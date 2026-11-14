import { describe, expect, it } from "vitest";
import type { Money } from "../pricing/money.js";
import type { SupportedCurrency } from "../pricing/currency.js";
import { MAX_AMOUNT } from "../pricing/limits.js";
import { decideFreeShippingProgress, type FreeShippingMethod } from "./free-shipping.js";
import { decideShippingPrice } from "./pricing.js";

const money = (amount: number): Money => ({ amount, currency: "UAH" });
const method = (overrides: Partial<FreeShippingMethod> = {}): FreeShippingMethod => ({
  kind: "address",
  isActive: true,
  currency: "UAH",
  providerEnabled: true,
  pricing: { type: "free_over", amount: 100, freeFrom: 1000 },
  ...overrides,
});
const decide = (methods: readonly FreeShippingMethod[], subtotal = 400) =>
  decideFreeShippingProgress({ methods, shopCurrency: "UAH", subtotal: money(subtotal) });

describe("decideFreeShippingProgress", () => {
  it("returns null without methods", () => {
    expect(decide([])).toBeNull();
  });
  it("ignores flat (even free), tiers and carrier pricing", () => {
    expect(
      decide([
        method({ pricing: { type: "flat", amount: 0 } }),
        method({ pricing: { type: "tiers", tiers: [{ fromSubtotal: 0, amount: 0 }] } }),
        method({ pricing: { type: "carrier_on_delivery" } }),
      ]),
    ).toBeNull();
  });
  it("chooses the lowest valid offered threshold", () => {
    expect(
      decide([
        method(),
        method({ pricing: { type: "free_over", amount: 100, freeFrom: 700 } }),
        method({ isActive: false, pricing: { type: "free_over", amount: 100, freeFrom: 1 } }),
        method({ currency: "EUR", pricing: { type: "free_over", amount: 100, freeFrom: 2 } }),
        method({ pricing: { type: "free_over", amount: -1, freeFrom: 3 } }),
      ]),
    ).toEqual({ threshold: money(700), remaining: money(300) });
  });
  it("ignores inactive, other-currency and invalid stored methods on their own", () => {
    for (const candidate of [
      method({ isActive: false }),
      method({ currency: "EUR" }),
      method({ pricing: null }),
      method({ pricing: { type: "free_over", freeFrom: 1 } }),
    ]) {
      expect(decide([candidate])).toBeNull();
    }
  });
  it("requires a loaded provider only for pickup points", () => {
    expect(decide([method({ kind: "pickup_point", providerEnabled: false })])).toBeNull();
    expect(decide([method({ kind: "pickup_point" })])?.threshold).toEqual(money(1000));
    expect(decide([method({ providerEnabled: false })])?.threshold).toEqual(money(1000));
  });
  it.each([
    [0, 1000],
    [400, 600],
    [1000, 0],
    [1500, 0],
  ])("subtotal %i has remaining %i", (subtotal, remaining) => {
    expect(decide([method()], subtotal)).toEqual({
      threshold: money(1000),
      remaining: money(remaining),
    });
  });
  it("uses a zero effective threshold when free-over shipping already costs zero", () => {
    const chosen = method({ pricing: { type: "free_over", amount: 0, freeFrom: 1000 } });
    for (const subtotal of [0, 400, 1000, 1500]) {
      expect(decide([method(), chosen], subtotal)).toEqual({
        threshold: money(0),
        remaining: money(0),
      });
      const price = decideShippingPrice(chosen.pricing, {
        subtotal: money(subtotal),
        currency: "UAH",
      });
      expect(price).toMatchObject({ ok: true, price: money(0) });
    }
  });
  it("supports a zero threshold", () => {
    expect(
      decide([method({ pricing: { type: "free_over", amount: 100, freeFrom: 0 } })], 0),
    ).toEqual({ threshold: money(0), remaining: money(0) });
  });
  it.each([0, 100])(
    "agrees with shipping price for amount %i across thresholds and subtotals",
    (amount) => {
      for (const freeFrom of [0, 1, 1000, MAX_AMOUNT]) {
        const chosen = method({ pricing: { type: "free_over", amount, freeFrom } });
        for (const subtotal of [0, 1, 999, 1000, 1001, MAX_AMOUNT]) {
          const progress = decide([chosen], subtotal);
          const price = decideShippingPrice(chosen.pricing, {
            subtotal: money(subtotal),
            currency: "UAH",
          });
          expect(price.ok).toBe(true);
          if (!price.ok) throw new Error("Valid pricing refused");
          expect(progress?.remaining.amount === 0).toBe(price.price.amount === 0);
        }
      }
    },
  );
  it("does not mutate inputs and freezes all returned values", () => {
    const methods = Object.freeze([
      Object.freeze(
        method({ pricing: Object.freeze({ type: "free_over", amount: 100, freeFrom: 1000 }) }),
      ),
    ]);
    const before = JSON.stringify(methods);
    const result = decide(methods);
    expect(JSON.stringify(methods)).toBe(before);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result?.threshold)).toBe(true);
    expect(Object.isFrozen(result?.remaining)).toBe(true);
  });
  it("refuses invalid subtotals and unsupported shop currency, even without methods", () => {
    for (const subtotal of [
      null,
      {},
      money(-1),
      money(0.5),
      money(NaN),
      money(MAX_AMOUNT + 1),
      { amount: 1, currency: "XYZ" },
    ]) {
      expect(() =>
        decideFreeShippingProgress({
          methods: [],
          shopCurrency: "UAH",
          subtotal: subtotal as Money,
        }),
      ).toThrow(RangeError);
    }
    expect(() =>
      decideFreeShippingProgress({
        methods: [],
        shopCurrency: "XYZ" as SupportedCurrency,
        subtotal: money(0),
      }),
    ).toThrow(RangeError);
  });
});
