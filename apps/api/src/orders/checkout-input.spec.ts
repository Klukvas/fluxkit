import { describe, expect, it } from "vitest";
import { ProblemException } from "../common/problem.js";
import { parseCheckoutInput, type CheckoutBody } from "./checkout-input.js";

const valid: CheckoutBody = {
  email: "  Buyer@Example.COM ",
  phone: "+38 (050) 123-45-67",
  firstName: " Іван ",
  lastName: "Петренко",
  shippingAddress: {
    countryCode: "UA",
    city: " Київ ",
    line1: "вул. Хрещатик 1",
    recipientPhone: "050 123 45 67",
  },
  expectedTotal: { amount: 12_500, currency: "UAH" },
};

function without(body: CheckoutBody, key: keyof CheckoutBody): CheckoutBody {
  return Object.fromEntries(Object.entries(body).filter(([name]) => name !== key)) as CheckoutBody;
}

function errorsOf(body: CheckoutBody, signedInEmail?: string): { path: string; code: string }[] {
  try {
    parseCheckoutInput(body, signedInEmail);
  } catch (error) {
    if (error instanceof ProblemException) {
      expect(error.code).toBe("validation_failed");
      return (error.errors ?? []).map(({ path, code }) => ({ path, code }));
    }
    throw error;
  }
  throw new Error("The input was accepted");
}

describe("parseCheckoutInput", () => {
  it("normalizes everything it keeps: email, phone, names, addresses", () => {
    const input = parseCheckoutInput(valid, undefined);
    expect(input.email).toBe("buyer@example.com");
    expect(input.phone).toBe("+380501234567");
    expect(input.firstName).toBe("Іван");
    expect(input.lastName).toBe("Петренко");
    expect(input.shippingAddress).toEqual({
      countryCode: "UA",
      city: "Київ",
      line1: "вул. Хрещатик 1",
      recipientPhone: "0501234567",
    });
    expect(input.billingAddress).toBeNull();
    expect(input.expectedTotal).toEqual({ amount: 12_500, currency: "UAH" });
    expect(input.requestedLocale).toBeUndefined();
  });

  it("keeps a requested locale as it is (the service checks it against the configured ones)", () => {
    expect(parseCheckoutInput({ ...valid, locale: "en" }, undefined).requestedLocale).toBe("en");
  });

  it("takes the account email of a signed-in customer when none is sent, and the sent one otherwise", () => {
    expect(parseCheckoutInput(without(valid, "email"), "account@example.com").email).toBe(
      "account@example.com",
    );
    expect(parseCheckoutInput(valid, "account@example.com").email).toBe("buyer@example.com");
  });

  it("requires an email of a guest", () => {
    expect(errorsOf(without(valid, "email"))).toEqual([{ path: "email", code: "required" }]);
  });

  it("accepts null addresses as not sent", () => {
    const input = parseCheckoutInput(
      { ...valid, shippingAddress: null, billingAddress: null },
      undefined,
    );
    expect(input.shippingAddress).toBeNull();
    expect(input.billingAddress).toBeNull();
  });

  it("reports every problem at once with the path of the field", () => {
    const errors = errorsOf({
      email: "not-an-email",
      phone: "12",
      firstName: "  ",
      lastName: "x".repeat(101),
      shippingAddress: { countryCode: "ukr", city: "", line1: "a", extra: "1" } as never,
      billingAddress: { city: "Київ", line1: "b" } as never,
      expectedTotal: { amount: -1, currency: "XXX" },
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        { path: "email", code: "invalid_format" },
        { path: "phone", code: "too_short" },
        { path: "firstName", code: "empty" },
        { path: "lastName", code: "too_long" },
        { path: "shippingAddress.countryCode", code: "invalid_format" },
        { path: "shippingAddress.city", code: "empty" },
        { path: "shippingAddress.extra", code: "unknown_field" },
        { path: "billingAddress.countryCode", code: "required" },
        { path: "expectedTotal.currency", code: "unsupported_currency" },
      ]),
    );
    expect(errors.length).toBeGreaterThanOrEqual(9);
  });

  it("refuses an expected total that is not whole, negative or too large", () => {
    expect(errorsOf({ ...valid, expectedTotal: { amount: 1.5, currency: "UAH" } })).toEqual([
      { path: "expectedTotal.amount", code: "not_an_integer" },
    ]);
    expect(errorsOf({ ...valid, expectedTotal: { amount: -5, currency: "UAH" } })).toEqual([
      { path: "expectedTotal.amount", code: "negative_amount" },
    ]);
    expect(errorsOf({ ...valid, expectedTotal: { amount: 1e13, currency: "UAH" } })).toEqual([
      { path: "expectedTotal.amount", code: "amount_out_of_range" },
    ]);
  });

  it("does not change its input", () => {
    const frozen = Object.freeze({
      ...valid,
      shippingAddress: Object.freeze({ ...valid.shippingAddress }),
    }) as CheckoutBody;
    expect(() => parseCheckoutInput(frozen, undefined)).not.toThrow();
  });
});
