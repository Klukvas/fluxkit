import { describe, expect, it } from "vitest";
import { CODE_PATTERN } from "../catalog/limits.js";
import {
  CARRIER_CODE_PATTERN,
  CARRIER_REFERENCE_PATTERN,
  COUNTRY_CODE_PATTERN,
  SHIPPING_LIMITS,
  SHIPPING_METHOD_CODE_PATTERN,
  SHIPPING_METHOD_KINDS,
  SHIPPING_PAYERS,
  SHIPPING_PROVIDER_CODE_PATTERN,
  SHIPPING_PROVIDER_TIMEOUTS_MS,
} from "./limits.js";
import {
  SHIPPING_PROBLEM_CODES,
  SHIPPING_RULE_VIOLATIONS,
  SHIPPING_VALIDATION_REASONS,
} from "./reasons.js";

describe("shipping codes, patterns and limits (ADR 0029)", () => {
  it("has the method kinds and payers of decision 7", () => {
    expect(SHIPPING_METHOD_KINDS).toEqual(["address", "pickup_point", "store_pickup"]);
    expect(SHIPPING_PAYERS).toEqual(["shop_charge", "recipient_on_delivery"]);
  });

  it("uses the shared code pattern for method and provider codes", () => {
    expect(SHIPPING_METHOD_CODE_PATTERN).toBe(CODE_PATTERN);
    expect(SHIPPING_PROVIDER_CODE_PATTERN).toBe(CODE_PATTERN);
    expect(SHIPPING_PROVIDER_CODE_PATTERN.test("nova_poshta")).toBe(true);
  });

  it("matches country codes, carrier refs and carrier codes strictly", () => {
    expect(COUNTRY_CODE_PATTERN.test("UA")).toBe(true);
    for (const code of ["ua", "UKR", "U", "U1", "UA "]) {
      expect(COUNTRY_CODE_PATTERN.test(code), code).toBe(false);
    }
    expect(CARRIER_REFERENCE_PATTERN.test("1ec09d88-e1c2-11e3-8c4a-0050568002cf")).toBe(true);
    for (const ref of ["", "a b", "a/b", "a.b", "x".repeat(65)]) {
      expect(CARRIER_REFERENCE_PATTERN.test(ref), ref).toBe(false);
    }
    expect(CARRIER_CODE_PATTERN.test("20000200039")).toBe(true);
    expect(CARRIER_CODE_PATTERN.test("bad key")).toBe(false);
  });

  it("has the limits and timeouts the ADR names", () => {
    expect(SHIPPING_LIMITS).toMatchObject({
      lookupQueryMinLength: 2,
      lookupQueryMaxLength: 50,
      maxCitiesPerPage: 50,
      maxPickupPointsPerPage: 200,
      seatsPerShipment: 1,
      maxTrackingNumbersPerCall: 100,
    });
    expect(SHIPPING_PROVIDER_TIMEOUTS_MS).toEqual({ lookup: 5000, estimate: 5000, waybill: 15000 });
    expect(Object.isFrozen(SHIPPING_LIMITS)).toBe(true);
  });

  it("has exactly the problem, reason and rule codes of ADR 0029", () => {
    expect(SHIPPING_PROBLEM_CODES).toEqual([
      "shipping_method_required",
      "shipping_not_applicable",
      "shipping_changed",
      "shipping_provider_unavailable",
    ]);
    expect(SHIPPING_VALIDATION_REASONS).toEqual(["unknown_pickup_point"]);
    expect(SHIPPING_RULE_VIOLATIONS).toEqual(["method_in_use"]);
  });
});
