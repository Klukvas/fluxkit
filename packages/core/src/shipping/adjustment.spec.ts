import { describe, expect, it } from "vitest";
import { deepFreeze } from "../catalog/test-support.js";
import { computeOrderTotals } from "../orders/totals.js";
import type { SupportedCurrency } from "../pricing/currency.js";
import { MAX_AMOUNT } from "../pricing/limits.js";
import type { Money } from "../pricing/money.js";
import { buildShippingAdjustment } from "./adjustment.js";
import type { ShippingAdjustmentInput } from "./adjustment.js";
import { decideShippingPrice } from "./pricing.js";

const money = (amount: number, currency: SupportedCurrency = "UAH"): Money => ({
  amount,
  currency,
});

const input = (overrides: Partial<ShippingAdjustmentInput> = {}): ShippingAdjustmentInput =>
  deepFreeze({
    methodCode: "courier",
    title: { uk: "Кур'єр", en: "Courier" },
    price: money(5000),
    providerCode: null,
    ...overrides,
  });

describe("buildShippingAdjustment", () => {
  it("builds the shipping adjustment row: added to the total, labelled with the method title", () => {
    expect(buildShippingAdjustment(input())).toEqual({
      kind: "shipping",
      code: "courier",
      label: { uk: "Кур'єр", en: "Courier" },
      amount: money(5000),
      includedInPrice: false,
      source: null,
    });
  });

  it("names the provider as the source", () => {
    expect(
      buildShippingAdjustment(input({ methodCode: "np_branch", providerCode: "nova_poshta" }))
        .source,
    ).toBe("nova_poshta");
  });

  it("accepts a zero price (free or paid to the carrier: the row still names the method)", () => {
    expect(buildShippingAdjustment(input({ price: money(0) })).amount).toEqual(money(0));
  });

  it("returns a deep-frozen copy and does not keep the caller's title object", () => {
    const given = input();
    const built = buildShippingAdjustment(given);
    expect(Object.isFrozen(built)).toBe(true);
    expect(Object.isFrozen(built.label)).toBe(true);
    expect(Object.isFrozen(built.amount)).toBe(true);
    expect(built.label).not.toBe(given.title);
  });

  it.each([
    ["a negative price", { price: money(-1) }],
    ["a price above MAX_AMOUNT", { price: money(MAX_AMOUNT + 1) }],
    ["a fractional price", { price: money(1.5) }],
    ["an unsupported currency", { price: { amount: 1, currency: "XYZ" } as unknown as Money }],
    ["a malformed method code", { methodCode: "Courier" }],
    ["an empty method code", { methodCode: "" }],
    ["a malformed provider code", { providerCode: "nova-poshta" }],
    ["an empty title", { title: {} }],
    [
      "a title that is not a map of texts",
      { title: { uk: 5 } as unknown as Record<string, string> },
    ],
    ["a title with an empty text", { title: { uk: " " } }],
    ["a title that is a list", { title: ["x"] as unknown as Record<string, string> }],
  ])("throws for %s (a caller bug: the data was validated at write)", (_, overrides) => {
    expect(() =>
      buildShippingAdjustment(input(overrides as Partial<ShippingAdjustmentInput>)),
    ).toThrow(RangeError);
  });
});

describe("the shipping adjustment in the order totals", () => {
  const lines = [{ lineTotal: money(120_000) }, { lineTotal: money(30_000) }];

  it("adds the decided price to the total and reports it as shippingTotal", () => {
    const decision = decideShippingPrice(
      { type: "free_over", amount: 7000, freeFrom: 200_000 },
      { subtotal: money(150_000), currency: "UAH" },
    );
    if (!decision.ok) {
      expect.unreachable();
    }
    const adjustment = buildShippingAdjustment(input({ price: decision.price }));
    const result = computeOrderTotals(lines, [adjustment]);
    expect(result).toEqual({
      ok: true,
      totals: {
        subtotal: money(150_000),
        shippingTotal: money(7000),
        discountTotal: money(0),
        taxTotal: money(0),
        total: money(157_000),
      },
    });
  });

  it("a free method leaves the total at the subtotal", () => {
    const result = computeOrderTotals(lines, [buildShippingAdjustment(input({ price: money(0) }))]);
    expect(result.ok && result.totals.total).toEqual(money(150_000));
  });

  it("a total pushed past MAX_AMOUNT by shipping is total_out_of_range, never clamped", () => {
    const top = [{ lineTotal: money(MAX_AMOUNT) }];
    expect(computeOrderTotals(top, [buildShippingAdjustment(input({ price: money(1) }))])).toEqual({
      ok: false,
      reason: "total_out_of_range",
    });
    expect(
      computeOrderTotals(
        [{ lineTotal: money(MAX_AMOUNT - 1) }],
        [buildShippingAdjustment(input({ price: money(1) }))],
      ),
    ).toEqual({
      ok: true,
      totals: {
        subtotal: money(MAX_AMOUNT - 1),
        shippingTotal: money(1),
        discountTotal: money(0),
        taxTotal: money(0),
        total: money(MAX_AMOUNT),
      },
    });
  });

  it("a shipping price in another currency than the lines is currency_mismatch", () => {
    expect(
      computeOrderTotals(lines, [buildShippingAdjustment(input({ price: money(100, "USD") }))]),
    ).toEqual({ ok: false, reason: "currency_mismatch" });
  });
});
