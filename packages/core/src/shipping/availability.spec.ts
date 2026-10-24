import { describe, expect, it } from "vitest";
import { deepFreeze } from "../catalog/test-support.js";
import type { SupportedCurrency } from "../pricing/currency.js";
import { decideMethodAvailability, validateCountryCodes } from "./availability.js";
import type { ShippingMethodFacts } from "./availability.js";
import { SHIPPING_LIMITS } from "./limits.js";
import type { ShippingMethodKind } from "./limits.js";

const method = (overrides: Partial<ShippingMethodFacts> = {}): ShippingMethodFacts =>
  deepFreeze({
    kind: "address" as ShippingMethodKind,
    isActive: true,
    currency: "UAH",
    countryCodes: ["UA", "PL"],
    ...overrides,
  });

const decide = (facts: ShippingMethodFacts, countryCode?: string, shopCurrency = "UAH") =>
  decideMethodAvailability(
    facts,
    countryCode === undefined
      ? { shopCurrency: shopCurrency as SupportedCurrency }
      : { shopCurrency: shopCurrency as SupportedCurrency, countryCode },
  );

describe("decideMethodAvailability", () => {
  it("offers an active method in the shop currency that serves the country", () => {
    expect(decide(method(), "UA")).toEqual({ available: true });
    expect(decide(method(), "PL")).toEqual({ available: true });
  });

  it("refuses an inactive method first", () => {
    expect(decide(method({ isActive: false, currency: "USD" }), "DE")).toEqual({
      available: false,
      reason: "inactive",
    });
  });

  it("never offers a method whose currency is not the shop currency", () => {
    expect(decide(method({ currency: "USD" }), "UA")).toEqual({
      available: false,
      reason: "currency_not_offered",
    });
    expect(decide(method({ currency: "uah" }), "UA")).toEqual({
      available: false,
      reason: "currency_not_offered",
    });
  });

  it("refuses a country outside the list (exact, upper-case codes)", () => {
    expect(decide(method(), "DE")).toEqual({ available: false, reason: "country_not_served" });
    expect(decide(method(), "ua")).toEqual({ available: false, reason: "country_not_served" });
    expect(decide(method(), "")).toEqual({ available: false, reason: "country_not_served" });
  });

  it("needs a country for kinds address and pickup_point", () => {
    expect(decide(method())).toEqual({ available: false, reason: "country_required" });
    expect(decide(method({ kind: "pickup_point" }))).toEqual({
      available: false,
      reason: "country_required",
    });
  });

  it("offers store_pickup without a country, and checks the country when one is given", () => {
    const pickup = method({ kind: "store_pickup", countryCodes: ["UA"] });
    expect(decide(pickup)).toEqual({ available: true });
    expect(decide(pickup, "UA")).toEqual({ available: true });
    expect(decide(pickup, "PL")).toEqual({ available: false, reason: "country_not_served" });
  });

  it("throws for an unknown kind or shop currency (a bug)", () => {
    expect(() => decide(method({ kind: "drone" as ShippingMethodKind }), "UA")).toThrow(RangeError);
    expect(() => decide(method(), "UA", "XYZ")).toThrow(RangeError);
  });

  it("returns frozen answers", () => {
    expect(Object.isFrozen(decide(method(), "UA"))).toBe(true);
    expect(Object.isFrozen(decide(method(), "DE"))).toBe(true);
  });
});

describe("validateCountryCodes", () => {
  it("accepts distinct alpha-2 codes and returns a frozen copy", () => {
    const input = ["UA", "PL"];
    const result = validateCountryCodes(deepFreeze(input));
    expect(result).toEqual({ ok: true, countryCodes: ["UA", "PL"] });
    expect(result.ok && result.countryCodes !== input && Object.isFrozen(result.countryCodes)).toBe(
      true,
    );
  });

  it("refuses a non-list, an empty list and a list that is too long", () => {
    expect(validateCountryCodes("UA")).toEqual({
      ok: false,
      errors: [{ index: null, reason: "not_an_array" }],
    });
    expect(validateCountryCodes([])).toEqual({
      ok: false,
      errors: [{ index: null, reason: "empty" }],
    });
    const many = Array.from({ length: SHIPPING_LIMITS.maxCountriesPerMethod + 1 }, () => "UA");
    expect(validateCountryCodes(many)).toEqual({
      ok: false,
      errors: [{ index: null, reason: "too_many" }],
    });
  });

  it("reports malformed and duplicate codes by position", () => {
    expect(validateCountryCodes(["UA", "ua", "UKR", 5, "UA", "PL", " PL"])).toEqual({
      ok: false,
      errors: [
        { index: 1, reason: "invalid_format" },
        { index: 2, reason: "invalid_format" },
        { index: 3, reason: "invalid_format" },
        { index: 4, reason: "duplicate" },
        { index: 6, reason: "invalid_format" },
      ],
    });
  });
});
