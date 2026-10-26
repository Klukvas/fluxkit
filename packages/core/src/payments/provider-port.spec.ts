import { describe, expect, it } from "vitest";
import {
  PAYMENT_CARD_LAST4_PATTERN,
  PAYMENT_CARD_SYSTEM_PATTERN,
  PAYMENT_CHECK_DELAYS_MINUTES,
  PAYMENT_CHECK_HOURLY_CHECKS,
  PAYMENT_CODE_PATTERN,
  PAYMENT_EXPIRY_DEFERRAL,
  PAYMENT_INVOICE_WINDOW,
  PAYMENT_LIMITS,
  PAYMENT_PROVIDER_CODE_PATTERN,
  PAYMENT_PROVIDER_STATUS_PATTERN,
  PAYMENT_PROVIDER_TIMEOUT_MS,
  PROVIDER_PAYMENT_ID_PATTERN,
} from "./limits.js";
import {
  PAYMENT_PROVIDER_FAILURE_REASONS,
  PAYMENT_PROVIDER_METADATA,
  PAYMENT_PROVIDER_PACKAGE_KIND,
  paymentProviderFailure,
  paymentProviderMetadata,
  paymentProviderOk,
  PROVIDER_PAYMENT_STATUSES,
  PROVIDER_REFUND_STATUSES,
} from "./provider-port.js";

describe("payment provider port constants", () => {
  it("has the metadata key, the package kind and the eight reasons of ADR 0032 decision 3", () => {
    expect(PAYMENT_PROVIDER_METADATA).toBe("fluxkit:payment-provider");
    expect(PAYMENT_PROVIDER_PACKAGE_KIND).toBe("payment");
    expect([...PAYMENT_PROVIDER_FAILURE_REASONS]).toEqual([
      "unavailable",
      "rate_limited",
      "rejected",
      "misconfigured",
      "not_found",
      "not_cancellable",
      "invalid_signature",
      "not_sent",
    ]);
    expect([...PROVIDER_PAYMENT_STATUSES]).toEqual([
      "created",
      "processing",
      "authorized",
      "succeeded",
      "failed",
      "reversed",
      "expired",
    ]);
    expect([...PROVIDER_REFUND_STATUSES]).toEqual(["processing", "succeeded", "failed"]);
  });

  it("paymentProviderMetadata checks the code", () => {
    expect(paymentProviderMetadata("monobank")).toEqual({ code: "monobank" });
    expect(Object.isFrozen(paymentProviderMetadata("fake"))).toBe(true);
    for (const code of ["", "Monobank", "mono-bank", "1mono", "a".repeat(65)]) {
      expect(() => paymentProviderMetadata(code), code).toThrow(RangeError);
    }
  });
});

describe("limits and patterns", () => {
  it("has the times of ADR 0032 decisions 3, 8, 9 and 13", () => {
    expect(PAYMENT_PROVIDER_TIMEOUT_MS).toBe(10_000);
    expect(PAYMENT_INVOICE_WINDOW).toEqual({ marginMinutes: 3, minimumMinutes: 5 });
    expect(PAYMENT_EXPIRY_DEFERRAL).toEqual({ stepMinutes: 10, capMinutes: 30 });
    expect([...PAYMENT_CHECK_DELAYS_MINUTES]).toEqual([1, 2, 5, 10, 30]);
    expect(PAYMENT_CHECK_HOURLY_CHECKS).toBe(48);
    expect(PAYMENT_LIMITS).toMatchObject({
      webhookBodyMaxBytes: 64 * 1024,
      providerAnswerMaxBytes: 64 * 1024,
      descriptionMaxLength: 280,
      maxProviderCodes: 10,
      providerReferenceMaxLength: 255,
      refundNoteMaxLength: 500,
    });
    expect(Object.isFrozen(PAYMENT_LIMITS)).toBe(true);
  });

  it("codes are short and have no spaces, so a provider's message text never fits", () => {
    expect(PAYMENT_CODE_PATTERN.test("CANCEL_NOT_AVAILABLE")).toBe(true);
    expect(PAYMENT_CODE_PATTERN.test("http:429")).toBe(true);
    expect(PAYMENT_CODE_PATTERN.test("Invalid card number 4111")).toBe(false);
    expect(PAYMENT_CODE_PATTERN.test("a".repeat(65))).toBe(false);
    expect(PAYMENT_CODE_PATTERN.test("")).toBe(false);
  });

  it("provider ids and statuses have no colon, so `<provider>:<id>` and the dedupe keys stay unambiguous", () => {
    expect(PROVIDER_PAYMENT_ID_PATTERN.test("p2_9ZgpZVsl3")).toBe(true);
    expect(PROVIDER_PAYMENT_ID_PATTERN.test("a:b")).toBe(false);
    expect(PROVIDER_PAYMENT_ID_PATTERN.test("")).toBe(false);
    expect(PROVIDER_PAYMENT_ID_PATTERN.test("a".repeat(65))).toBe(false);
    expect(PAYMENT_PROVIDER_STATUS_PATTERN.test("success")).toBe(true);
    expect(PAYMENT_PROVIDER_STATUS_PATTERN.test("a:b")).toBe(false);
    expect(PAYMENT_PROVIDER_CODE_PATTERN.test("monobank")).toBe(true);
  });

  it("card data is the system and the last four digits only (question 12)", () => {
    expect(PAYMENT_CARD_LAST4_PATTERN.test("4242")).toBe(true);
    for (const value of ["424", "42424", "424a", "4111 1111 1111 1111"]) {
      expect(PAYMENT_CARD_LAST4_PATTERN.test(value), value).toBe(false);
    }
    expect(PAYMENT_CARD_SYSTEM_PATTERN.test("visa")).toBe(true);
    expect(PAYMENT_CARD_SYSTEM_PATTERN.test("444111******1111")).toBe(false);
  });
});

describe("paymentProviderOk / paymentProviderFailure", () => {
  it("builds frozen results", () => {
    const ok = paymentProviderOk({ invalidated: true });
    expect(ok).toEqual({ ok: true, value: { invalidated: true } });
    expect(Object.isFrozen(ok)).toBe(true);
    const failure = paymentProviderFailure("rate_limited", {
      providerCodes: ["TMR", "http:429"],
      retryAfterSeconds: 5,
    });
    expect(failure).toEqual({
      ok: false,
      reason: "rate_limited",
      providerCodes: ["TMR", "http:429"],
      retryAfterSeconds: 5,
    });
    expect(Object.isFrozen(failure)).toBe(true);
    expect(Object.isFrozen(failure.providerCodes)).toBe(true);
    expect(paymentProviderFailure("not_sent")).toEqual({
      ok: false,
      reason: "not_sent",
      providerCodes: [],
    });
  });

  it("copies the codes", () => {
    const codes = ["a"];
    const failure = paymentProviderFailure("rejected", { providerCodes: codes });
    codes.push("b");
    expect(failure.providerCodes).toEqual(["a"]);
  });

  it("refuses message text, too many codes, a bad retry-after and unknown reasons", () => {
    expect(() =>
      paymentProviderFailure("rejected", { providerCodes: ["Card 4111 declined by bank"] }),
    ).toThrow(RangeError);
    expect(() =>
      paymentProviderFailure("rejected", { providerCodes: Array.from({ length: 11 }, () => "x") }),
    ).toThrow(RangeError);
    for (const retryAfterSeconds of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => paymentProviderFailure("rate_limited", { retryAfterSeconds })).toThrow(
        RangeError,
      );
    }
    expect(() => paymentProviderFailure("gone" as "rejected")).toThrow(RangeError);
  });
});
