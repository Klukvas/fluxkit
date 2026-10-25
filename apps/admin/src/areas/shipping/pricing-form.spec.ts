import type { AdminShippingPricing } from "@fluxkit/api-client";
import { validateShippingPricing } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import {
  MAX_TIERS,
  PRICING_TYPES,
  emptyPricingValues,
  pricingFromValues,
  pricingValuesFrom,
  type PricingValues,
} from "./pricing-form";

const UAH = 2;
const JPY = 0;
const KWD = 3;

function values(overrides: Partial<PricingValues>): PricingValues {
  return { ...emptyPricingValues("flat"), ...overrides };
}

function ok(result: ReturnType<typeof pricingFromValues>) {
  if (!result.ok)
    throw new Error(`Expected a pricing, got issues ${JSON.stringify(result.issues)}`);
  return result.pricing;
}

function issues(result: ReturnType<typeof pricingFromValues>) {
  if (result.ok) throw new Error(`Expected issues, got ${JSON.stringify(result.pricing)}`);
  return Object.fromEntries(Object.entries(result.issues).map(([path, d]) => [path, d?.key]));
}

describe("pricingFromValues: decimals to integer minor units (no float math)", () => {
  it("converts a flat amount with the currency's exponent: UAH 2, JPY 0, KWD 3", () => {
    expect(ok(pricingFromValues(values({ amount: "80" }), UAH))).toEqual({
      type: "flat",
      amount: 8000,
    });
    expect(ok(pricingFromValues(values({ amount: "80.5" }), UAH))).toEqual({
      type: "flat",
      amount: 8050,
    });
    expect(ok(pricingFromValues(values({ amount: "800" }), JPY))).toEqual({
      type: "flat",
      amount: 800,
    });
    expect(ok(pricingFromValues(values({ amount: "1.234" }), KWD))).toEqual({
      type: "flat",
      amount: 1234,
    });
    expect(ok(pricingFromValues(values({ amount: "1.2" }), KWD))).toEqual({
      type: "flat",
      amount: 1200,
    });
  });

  it("never rounds: amounts a float would get wrong stay exact, extra decimals are refused", () => {
    expect(ok(pricingFromValues(values({ amount: "0.29" }), UAH))).toEqual({
      type: "flat",
      amount: 29,
    });
    expect(ok(pricingFromValues(values({ amount: "1.15" }), UAH))).toEqual({
      type: "flat",
      amount: 115,
    });
    expect(ok(pricingFromValues(values({ amount: "4.35" }), UAH))).toEqual({
      type: "flat",
      amount: 435,
    });
    expect(issues(pricingFromValues(values({ amount: "1.005" }), UAH))).toEqual({
      "pricing.amount": "ship.money.too_many_decimals",
    });
    expect(issues(pricingFromValues(values({ amount: "1.5" }), JPY))).toEqual({
      "pricing.amount": "ship.money.too_many_decimals",
    });
    expect(issues(pricingFromValues(values({ amount: "1.2345" }), KWD))).toEqual({
      "pricing.amount": "ship.money.too_many_decimals",
    });
  });

  it("refuses what a price field must not guess: a comma, spaces, a minus, text, an empty field, a huge amount", () => {
    const reasons = (amount: string) =>
      issues(pricingFromValues(values({ amount }), UAH))["pricing.amount"];
    expect(reasons("")).toBe("ship.money.empty");
    expect(reasons("80,50")).toBe("ship.money.comma_separator");
    expect(reasons("1 000")).toBe("ship.money.inner_space");
    expect(reasons("-5")).toBe("ship.money.negative_amount");
    expect(reasons("abc")).toBe("ship.money.invalid_format");
    expect(reasons("1e3")).toBe("ship.money.invalid_format");
    expect(reasons("10000000000.01")).toBe("ship.money.amount_out_of_range");
  });

  it("accepts zero (free shipping) and exactly the largest amount", () => {
    expect(ok(pricingFromValues(values({ amount: "0" }), UAH))).toEqual({
      type: "flat",
      amount: 0,
    });
    expect(ok(pricingFromValues(values({ amount: "10000000000.00" }), UAH))).toEqual({
      type: "flat",
      amount: 1_000_000_000_000,
    });
  });

  it("converts free_over: the price and the threshold", () => {
    expect(
      ok(pricingFromValues(values({ type: "free_over", amount: "80", freeFrom: "2000.50" }), UAH)),
    ).toEqual({ type: "free_over", amount: 8000, freeFrom: 200050 });
    expect(
      issues(pricingFromValues(values({ type: "free_over", amount: "80", freeFrom: "" }), UAH)),
    ).toEqual({ "pricing.freeFrom": "ship.money.empty" });
  });

  it("converts every tier and keeps their order", () => {
    const result = pricingFromValues(
      values({
        type: "tiers",
        tiers: [
          { fromSubtotal: "0", amount: "120" },
          { fromSubtotal: "1000.00", amount: "60.5" },
          { fromSubtotal: "2000", amount: "0" },
        ],
      }),
      UAH,
    );
    expect(ok(result)).toEqual({
      type: "tiers",
      tiers: [
        { fromSubtotal: 0, amount: 12000 },
        { fromSubtotal: 100000, amount: 6050 },
        { fromSubtotal: 200000, amount: 0 },
      ],
    });
  });

  it("sends only the fields of the chosen type, whatever else was typed before switching", () => {
    const stale = { amount: "99", freeFrom: "5", tiers: [{ fromSubtotal: "0", amount: "1" }] };
    expect(ok(pricingFromValues(values({ ...stale, type: "carrier_on_delivery" }), UAH))).toEqual({
      type: "carrier_on_delivery",
    });
    expect(ok(pricingFromValues(values({ ...stale, type: "flat" }), UAH))).toEqual({
      type: "flat",
      amount: 9900,
    });
  });

  it("produces what core's validateShippingPricing accepts, for every type", () => {
    const samples: PricingValues[] = [
      values({ type: "flat", amount: "80" }),
      values({ type: "free_over", amount: "80", freeFrom: "2000" }),
      values({
        type: "tiers",
        tiers: [
          { fromSubtotal: "0", amount: "120" },
          { fromSubtotal: "1000", amount: "60" },
        ],
      }),
      values({ type: "carrier_on_delivery" }),
    ];
    for (const sample of samples) {
      const pricing = ok(pricingFromValues(sample, UAH));
      expect(validateShippingPricing(pricing).ok, sample.type).toBe(true);
    }
  });
});

describe("pricingFromValues: the tier rules of core, checked before sending", () => {
  const tiers = (...pairs: [string, string][]) =>
    values({
      type: "tiers",
      tiers: pairs.map(([fromSubtotal, amount]) => ({ fromSubtotal, amount })),
    });

  it("needs at least one tier and at most MAX_TIERS (20)", () => {
    expect(MAX_TIERS).toBe(20);
    expect(issues(pricingFromValues(tiers(), UAH))).toEqual({
      "pricing.tiers": "ship.reason.no_tiers",
    });
    const many = Array.from({ length: 21 }, (_, index): [string, string] => [String(index), "1"]);
    expect(issues(pricingFromValues(tiers(...many), UAH))).toEqual({
      "pricing.tiers": "ship.reason.too_many_tiers",
    });
    const twenty = Array.from({ length: 20 }, (_, index): [string, string] => [String(index), "1"]);
    expect(pricingFromValues(tiers(...twenty), UAH).ok).toBe(true);
  });

  it("starts at zero, strictly ascends, and names the tier that breaks it (the API's path)", () => {
    expect(issues(pricingFromValues(tiers(["5", "1"]), UAH))).toEqual({
      "pricing.tiers.0.fromSubtotal": "ship.reason.first_tier_not_zero",
    });
    expect(issues(pricingFromValues(tiers(["0", "9"], ["10", "5"], ["10", "4"]), UAH))).toEqual({
      "pricing.tiers.2.fromSubtotal": "ship.reason.duplicate_tier",
    });
    expect(issues(pricingFromValues(tiers(["0", "9"], ["10", "5"], ["7", "4"]), UAH))).toEqual({
      "pricing.tiers.2.fromSubtotal": "ship.reason.tiers_not_sorted",
    });
  });

  it("reports a bad amount at its own tier and field, and leaves the order rules until every tier is readable", () => {
    expect(issues(pricingFromValues(tiers(["0", "x"], ["", "4"], ["1", "2"]), UAH))).toEqual({
      "pricing.tiers.0.amount": "ship.money.invalid_format",
      "pricing.tiers.1.fromSubtotal": "ship.money.empty",
    });
  });

  it("compares thresholds as minor units, not as text (9 < 10, 10.00 equals 10)", () => {
    expect(pricingFromValues(tiers(["0", "9"], ["9", "5"], ["10", "4"]), UAH).ok).toBe(true);
    expect(issues(pricingFromValues(tiers(["0", "9"], ["10", "5"], ["10.00", "4"]), UAH))).toEqual({
      "pricing.tiers.2.fromSubtotal": "ship.reason.duplicate_tier",
    });
  });
});

describe("pricingValuesFrom: stored minor units back to editable text", () => {
  it("shows each amount with the currency's exponent and round-trips", () => {
    const stored: AdminShippingPricing[] = [
      { type: "flat", amount: 8050 },
      { type: "free_over", amount: 8000, freeFrom: 200050 },
      {
        type: "tiers",
        tiers: [
          { fromSubtotal: 0, amount: 12000 },
          { fromSubtotal: 100000, amount: 0 },
        ],
      },
      { type: "carrier_on_delivery" },
    ];
    for (const exponent of [UAH, JPY, KWD]) {
      for (const pricing of stored) {
        const text = pricingValuesFrom(pricing, exponent);
        expect(
          ok(pricingFromValues(text, exponent)),
          `${pricing.type} @${String(exponent)}`,
        ).toEqual(pricing);
      }
    }
    expect(pricingValuesFrom({ type: "flat", amount: 8050 }, UAH).amount).toBe("80.50");
    expect(pricingValuesFrom({ type: "flat", amount: 8050 }, JPY).amount).toBe("8050");
    expect(pricingValuesFrom({ type: "flat", amount: 8050 }, KWD).amount).toBe("8.050");
  });

  it("has an empty form for every type", () => {
    for (const type of PRICING_TYPES) {
      const empty = emptyPricingValues(type);
      expect(empty.type).toBe(type);
      expect(empty.amount).toBe("");
    }
    expect(emptyPricingValues("tiers").tiers).toEqual([{ fromSubtotal: "0", amount: "" }]);
  });
});
