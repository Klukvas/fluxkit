import { describe, expect, it } from "vitest";
import { deepFreeze } from "../catalog/test-support.js";
import type { SupportedCurrency } from "../pricing/currency.js";
import { MAX_AMOUNT } from "../pricing/limits.js";
import type { Money } from "../pricing/money.js";
import { SHIPPING_UNAVAILABLE_REASONS } from "./availability.js";
import { quoteShippingMethod, SHIPPING_QUOTE_UNAVAILABLE_REASONS } from "./quote.js";
import type { ShippingQuoteInput, ShippingQuoteMethod } from "./quote.js";

const uah = (amount: number): Money => ({ amount, currency: "UAH" });

const method = (overrides: Partial<ShippingQuoteMethod> = {}): ShippingQuoteMethod =>
  deepFreeze({
    kind: "address",
    isActive: true,
    currency: "UAH",
    countryCodes: ["UA"],
    providerCode: null,
    pricing: { type: "flat", amount: 500 },
    ...overrides,
  } as ShippingQuoteMethod);

const quote = (overrides: Partial<ShippingQuoteInput> = {}) =>
  quoteShippingMethod({
    method: method(),
    providerEnabled: true,
    shopCurrency: "UAH" as SupportedCurrency,
    countryCode: "UA",
    subtotal: uah(5_000),
    ...overrides,
  });

describe("quoteShippingMethod (ADR 0029 decisions 3, 4 and 5)", () => {
  it("prices an available method and adds it to the subtotal", () => {
    expect(quote()).toEqual({
      available: true,
      price: uah(500),
      payer: "shop_charge",
      total: uah(5_500),
    });
  });

  it("free over a threshold: 0 at exactly the threshold, the amount one minor unit below", () => {
    const freeOver = method({ pricing: { type: "free_over", amount: 700, freeFrom: 10_000 } });
    expect(quote({ method: freeOver, subtotal: uah(10_000) })).toEqual({
      available: true,
      price: uah(0),
      payer: "shop_charge",
      total: uah(10_000),
    });
    expect(quote({ method: freeOver, subtotal: uah(9_999) })).toEqual({
      available: true,
      price: uah(700),
      payer: "shop_charge",
      total: uah(10_699),
    });
  });

  it("carrier on delivery charges 0 and names the recipient as the payer", () => {
    expect(quote({ method: method({ pricing: { type: "carrier_on_delivery" } }) })).toEqual({
      available: true,
      price: uah(0),
      payer: "recipient_on_delivery",
      total: uah(5_000),
    });
  });

  it("answers the first reason a method is not available, in the documented order", () => {
    expect(quote({ method: method({ isActive: false, currency: "USD" }) })).toEqual({
      available: false,
      reason: "inactive",
    });
    expect(
      quote({
        method: method({ currency: "USD", kind: "pickup_point", providerCode: "fake" }),
        providerEnabled: false,
      }),
    ).toEqual({ available: false, reason: "currency_not_offered" });
    expect(
      quote({
        method: method({ kind: "pickup_point", providerCode: "fake" }),
        providerEnabled: false,
        countryCode: "DE",
      }),
    ).toEqual({ available: false, reason: "provider_not_enabled" });
    expect(quote({ countryCode: undefined })).toEqual({
      available: false,
      reason: "country_required",
    });
    expect(quote({ countryCode: "PL", method: method({ pricing: { type: "nope" } }) })).toEqual({
      available: false,
      reason: "country_not_served",
    });
    expect(quote({ method: method({ pricing: { type: "flat", amount: -1 } }) })).toEqual({
      available: false,
      reason: "pricing_invalid",
    });
  });

  it("needs an enabled provider only for a pickup point (an address method's provider only estimates)", () => {
    expect(
      quote({ method: method({ providerCode: "fake" }), providerEnabled: false }).available,
    ).toBe(true);
    expect(
      quote({
        method: method({ kind: "pickup_point", providerCode: "fake" }),
        providerEnabled: true,
      }).available,
    ).toBe(true);
  });

  it("offers store pickup without a country", () => {
    expect(
      quote({
        method: method({ kind: "store_pickup", countryCodes: ["UA"] }),
        countryCode: undefined,
      }),
    ).toEqual({ available: true, price: uah(500), payer: "shop_charge", total: uah(5_500) });
  });

  it("answers total_out_of_range when subtotal plus shipping leaves the money range (never clamped)", () => {
    expect(
      quote({
        method: method({ pricing: { type: "flat", amount: 1 } }),
        subtotal: uah(MAX_AMOUNT),
      }),
    ).toEqual({ available: false, reason: "total_out_of_range" });
    expect(
      quote({
        method: method({ pricing: { type: "flat", amount: 1 } }),
        subtotal: uah(MAX_AMOUNT - 1),
      }),
    ).toEqual({ available: true, price: uah(1), payer: "shop_charge", total: uah(MAX_AMOUNT) });
  });

  it("lists the core availability reasons first, then its own", () => {
    expect(SHIPPING_QUOTE_UNAVAILABLE_REASONS).toEqual([
      ...SHIPPING_UNAVAILABLE_REASONS,
      "provider_not_enabled",
      "pricing_invalid",
      "total_out_of_range",
    ]);
  });

  it("a subtotal in another currency than the shop's is a bug of the caller", () => {
    expect(() => quote({ subtotal: { amount: 1, currency: "USD" } })).toThrow(RangeError);
  });

  it("returns frozen answers and does not change its input", () => {
    const input = deepFreeze({
      method: method(),
      providerEnabled: true,
      shopCurrency: "UAH" as SupportedCurrency,
      countryCode: "UA",
      subtotal: uah(1),
    });
    const answer = quoteShippingMethod(input);
    expect(Object.isFrozen(answer)).toBe(true);
  });
});
