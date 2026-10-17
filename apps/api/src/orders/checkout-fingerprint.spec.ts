import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  fingerprintsEqual,
  requestFingerprint,
  type FingerprintInput,
} from "./checkout-fingerprint.js";

const base: FingerprintInput = {
  cartId: "11111111-1111-4111-8111-111111111111",
  email: "buyer@example.com",
  phone: "+380501234567",
  firstName: "Іван",
  lastName: "Петренко",
  shippingAddress: { countryCode: "UA", city: "Київ", line1: "вул. Хрещатик 1" },
  billingAddress: null,
  locale: "uk",
  expectedTotal: { amount: 12_500, currency: "UAH" },
};

describe("canonicalJson", () => {
  it("sorts object keys at every depth and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 2, 1], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,2,1]},"b":1}',
    );
  });

  it("is the same for any key order of the input", () => {
    expect(canonicalJson({ a: 1, b: 2, c: { x: 1, y: 2 } })).toBe(
      canonicalJson({ c: { y: 2, x: 1 }, b: 2, a: 1 }),
    );
  });

  it("refuses values JSON cannot carry exactly (a bug of the caller)", () => {
    expect(() => canonicalJson({ a: undefined })).toThrow(RangeError);
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(RangeError);
    expect(() => canonicalJson({ a: () => 1 })).toThrow(RangeError);
    expect(() => canonicalJson({ a: 10n })).toThrow(RangeError);
  });
});

describe("requestFingerprint", () => {
  it("is a SHA-256 hex digest, stable for the same request", () => {
    const fingerprint = requestFingerprint(base);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(requestFingerprint({ ...base })).toBe(fingerprint);
  });

  it("does not depend on the key order of the address", () => {
    const reordered: FingerprintInput = {
      ...base,
      shippingAddress: { line1: "вул. Хрещатик 1", city: "Київ", countryCode: "UA" },
    };
    expect(requestFingerprint(reordered)).toBe(requestFingerprint(base));
  });

  const changes: [string, Partial<FingerprintInput>][] = [
    ["the cart", { cartId: "22222222-2222-4222-8222-222222222222" }],
    ["the email", { email: "other@example.com" }],
    ["the phone", { phone: "+380501234568" }],
    ["the first name", { firstName: "Іваn" }],
    ["the last name", { lastName: "Петренко " }],
    ["the shipping address", { shippingAddress: { countryCode: "UA", city: "Львів", line1: "x" } }],
    ["a missing shipping address", { shippingAddress: null }],
    ["the billing address", { billingAddress: { countryCode: "UA", city: "Київ", line1: "y" } }],
    ["the locale", { locale: "en" }],
    ["the expected amount", { expectedTotal: { amount: 12_501, currency: "UAH" } }],
    ["the expected currency", { expectedTotal: { amount: 12_500, currency: "USD" } }],
  ];

  it.each(changes)("changes with %s", (_name, change) => {
    expect(requestFingerprint({ ...base, ...change })).not.toBe(requestFingerprint(base));
  });

  it("cannot be confused by moving text between fields (no ambiguous concatenation)", () => {
    const one = requestFingerprint({ ...base, firstName: "ab", lastName: "c" });
    const two = requestFingerprint({ ...base, firstName: "a", lastName: "bc" });
    expect(one).not.toBe(two);
  });
});

describe("fingerprintsEqual", () => {
  const fingerprint = requestFingerprint(base);

  it("is true for the same digest and false for any other", () => {
    expect(fingerprintsEqual(fingerprint, fingerprint)).toBe(true);
    expect(fingerprintsEqual(fingerprint, requestFingerprint({ ...base, locale: "en" }))).toBe(
      false,
    );
  });

  it("is false (never throws) for a different length or a malformed value", () => {
    expect(fingerprintsEqual(fingerprint, fingerprint.slice(0, 63))).toBe(false);
    expect(fingerprintsEqual(fingerprint, "")).toBe(false);
    expect(fingerprintsEqual("not hex", "not hex")).toBe(false);
    expect(fingerprintsEqual(fingerprint, `${fingerprint}0`)).toBe(false);
  });

  it("differs in the last character only: still false", () => {
    const flipped = `${fingerprint.slice(0, 63)}${fingerprint.endsWith("0") ? "1" : "0"}`;
    expect(fingerprintsEqual(fingerprint, flipped)).toBe(false);
  });
});
