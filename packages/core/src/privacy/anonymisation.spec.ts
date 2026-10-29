import { describe, expect, it } from "vitest";
import {
  ORDER_ANONYMISATION_PLAN,
  ORDER_COLUMNS_KEPT_ON_ANONYMISATION,
  planOrderAnonymisation,
} from "./anonymisation.js";

const ERASED_AT = new Date("2026-11-01T10:00:00.000Z");
const OLD = "a".repeat(64);
const NEW = "b".repeat(64);

const address = {
  countryCode: "UA",
  city: "Київ",
  line1: "вул. Хрещатик 1",
  postalCode: "01001",
  recipientFirstName: "Іван",
  recipientLastName: "Петренко",
  recipientPhone: "+380501234567",
};

const run = (overrides: Partial<Parameters<typeof planOrderAnonymisation>[0]> = {}) =>
  planOrderAnonymisation(
    { shippingAddress: address, billingAddress: address, requestFingerprint: OLD, ...overrides },
    { erasedAt: ERASED_AT, newFingerprint: NEW },
  );

describe("planOrderAnonymisation (ADR 0033 decision 6)", () => {
  it("removes the contact fields, the free-text reason and the guest access, and records when", () => {
    expect(run()).toEqual({
      email: null,
      phone: null,
      firstName: null,
      lastName: null,
      shippingAddress: { countryCode: "UA" },
      billingAddress: { countryCode: "UA" },
      cancellationReason: null,
      accessTokenHash: null,
      accessExpiresAt: null,
      requestFingerprint: NEW,
      contactErasedAt: ERASED_AT,
    });
  });

  it("keeps only the country of an address: nothing else of it survives, recipient fields included", () => {
    const text = JSON.stringify(run());
    for (const leaked of ["Київ", "Хрещатик", "01001", "Іван", "Петренко", "+380501234567"]) {
      expect(text).not.toContain(leaked);
    }
  });

  it("leaves a missing address missing (a digital order has none)", () => {
    expect(run({ shippingAddress: null, billingAddress: null })).toMatchObject({
      shippingAddress: null,
      billingAddress: null,
    });
  });

  it("drops an address that has no valid country code rather than keep a fragment", () => {
    for (const bad of [
      { city: "Київ" },
      { countryCode: "ua" },
      { countryCode: 804 },
      "text",
      5,
      [],
    ]) {
      expect(run({ shippingAddress: bad }).shippingAddress, JSON.stringify(bad)).toBeNull();
    }
  });

  it("replaces the request fingerprint with the given new one, and refuses one that is not new", () => {
    expect(run().requestFingerprint).toBe(NEW);
    expect(() =>
      planOrderAnonymisation(
        { shippingAddress: null, billingAddress: null, requestFingerprint: NEW },
        { erasedAt: ERASED_AT, newFingerprint: NEW },
      ),
    ).toThrow(RangeError);
  });

  it("refuses a fingerprint that is not 64 lower-case hex characters", () => {
    for (const bad of ["", "abc", "B".repeat(64), `${"b".repeat(63)}g`, `${"b".repeat(65)}`]) {
      expect(() =>
        planOrderAnonymisation(
          { shippingAddress: null, billingAddress: null, requestFingerprint: OLD },
          { erasedAt: ERASED_AT, newFingerprint: bad },
        ),
      ).toThrow(RangeError);
    }
  });

  it("refuses an invalid erasure time", () => {
    expect(() =>
      planOrderAnonymisation(
        { shippingAddress: null, billingAddress: null, requestFingerprint: OLD },
        { erasedAt: new Date(Number.NaN), newFingerprint: NEW },
      ),
    ).toThrow(RangeError);
  });

  it("does not mutate its input", () => {
    const input = {
      shippingAddress: { ...address },
      billingAddress: null,
      requestFingerprint: OLD,
    };
    planOrderAnonymisation(input, { erasedAt: ERASED_AT, newFingerprint: NEW });
    expect(input.shippingAddress).toEqual(address);
  });
});

describe("the anonymisation plan as data", () => {
  it("names each changed column once, with one action", () => {
    const columns = ORDER_ANONYMISATION_PLAN.map((step) => step.column);
    expect(new Set(columns).size).toBe(columns.length);
    expect(columns.sort()).toEqual([
      "access_expires_at",
      "access_token_hash",
      "billing_address",
      "cancellation_reason",
      "contact_erased_at",
      "email",
      "first_name",
      "last_name",
      "phone",
      "request_fingerprint",
      "shipping_address",
    ]);
  });

  it("never touches a column the accounting record needs", () => {
    const changed = new Set(ORDER_ANONYMISATION_PLAN.map((step) => step.column));
    for (const kept of ORDER_COLUMNS_KEPT_ON_ANONYMISATION) {
      expect(changed.has(kept), kept).toBe(false);
    }
    for (const required of [
      "number",
      "status",
      "total_amount",
      "currency",
      "placed_at",
      "payment_reference",
    ]) {
      expect(ORDER_COLUMNS_KEPT_ON_ANONYMISATION).toContain(required);
    }
  });

  it("matches the values the function returns", () => {
    const returned = Object.keys(run()).length;
    expect(ORDER_ANONYMISATION_PLAN).toHaveLength(returned);
  });
});
