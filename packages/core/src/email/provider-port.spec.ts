import { describe, expect, it } from "vitest";
import {
  EMAIL_CODE_PATTERN,
  EMAIL_LOCALE_PATTERN,
  EMAIL_PROVIDER_CODE_PATTERN,
  EMAIL_TAG_VALUE_PATTERN,
  EMAIL_TEMPLATE_KEY_PATTERN,
} from "./limits.js";
import {
  EMAIL_PROVIDER_FAILURE_REASONS,
  EMAIL_PROVIDER_METADATA,
  EMAIL_PROVIDER_PACKAGE_KIND,
  emailProviderFailure,
  emailProviderMetadata,
  emailProviderOk,
} from "./provider-port.js";

describe("email provider port constants", () => {
  it("has the metadata key, package kind and the seven reasons of ADR 0031 decision 3", () => {
    expect(EMAIL_PROVIDER_METADATA).toBe("fluxkit:email-provider");
    expect(EMAIL_PROVIDER_PACKAGE_KIND).toBe("email");
    expect([...EMAIL_PROVIDER_FAILURE_REASONS]).toEqual([
      "unavailable",
      "rate_limited",
      "rejected",
      "misconfigured",
      "quota_exceeded",
      "idempotency_conflict",
      "not_sent",
    ]);
  });

  it("emailProviderMetadata checks the code", () => {
    expect(emailProviderMetadata("resend")).toEqual({ code: "resend" });
    expect(Object.isFrozen(emailProviderMetadata("fake"))).toBe(true);
    for (const code of ["", "Resend", "re-send", "1resend", "a".repeat(65)]) {
      expect(() => emailProviderMetadata(code), code).toThrow(RangeError);
    }
  });
});

describe("patterns", () => {
  it("template keys are dotted lower-case segments, at least two", () => {
    for (const key of ["order.placed", "customer.password_reset", "admin.test", "a.b.c"]) {
      expect(EMAIL_TEMPLATE_KEY_PATTERN.test(key), key).toBe(true);
    }
    for (const key of ["order", "Order.placed", "order.", ".order", "order..placed", "order.1x"]) {
      expect(EMAIL_TEMPLATE_KEY_PATTERN.test(key), key).toBe(false);
    }
  });

  it("codes are short and have no spaces, so a provider's message text never fits", () => {
    expect(EMAIL_CODE_PATTERN.test("daily_quota_exceeded")).toBe(true);
    expect(EMAIL_CODE_PATTERN.test("0b6f8d3e-1c2a-4d5e-9f10-a1b2c3d4e5f6")).toBe(true);
    expect(EMAIL_CODE_PATTERN.test("http:429")).toBe(true);
    expect(EMAIL_CODE_PATTERN.test("The to address a@b.test is invalid")).toBe(false);
    expect(EMAIL_CODE_PATTERN.test("a".repeat(65))).toBe(false);
    expect(EMAIL_CODE_PATTERN.test("")).toBe(false);
  });

  it("provider codes, locales and tags follow their rules", () => {
    expect(EMAIL_PROVIDER_CODE_PATTERN.test("resend")).toBe(true);
    expect(EMAIL_LOCALE_PATTERN.test("uk")).toBe(true);
    expect(EMAIL_LOCALE_PATTERN.test("en-gb")).toBe(true);
    expect(EMAIL_LOCALE_PATTERN.test("EN")).toBe(false);
    expect(EMAIL_TAG_VALUE_PATTERN.test("order")).toBe(true);
    expect(EMAIL_TAG_VALUE_PATTERN.test("order.placed")).toBe(false);
  });
});

describe("emailProviderOk / emailProviderFailure", () => {
  it("builds frozen results", () => {
    const ok = emailProviderOk({ providerMessageId: "abc" });
    expect(ok).toEqual({ ok: true, value: { providerMessageId: "abc" } });
    expect(Object.isFrozen(ok)).toBe(true);
    const failure = emailProviderFailure("rate_limited", {
      providerCodes: ["rate_limit_exceeded", "429"],
      retryAfterSeconds: 2,
    });
    expect(failure).toEqual({
      ok: false,
      reason: "rate_limited",
      providerCodes: ["rate_limit_exceeded", "429"],
      retryAfterSeconds: 2,
    });
    expect(Object.isFrozen(failure)).toBe(true);
    expect(Object.isFrozen(failure.providerCodes)).toBe(true);
    expect(emailProviderFailure("unavailable")).toEqual({
      ok: false,
      reason: "unavailable",
      providerCodes: [],
    });
    expect(
      emailProviderFailure("quota_exceeded", {
        providerCodes: ["daily_quota_exceeded"],
        quotaPeriod: "daily",
      }).quotaPeriod,
    ).toBe("daily");
  });

  it("copies the codes (a later change of the provider's array changes nothing)", () => {
    const codes = ["a"];
    const failure = emailProviderFailure("rejected", { providerCodes: codes });
    codes.push("b");
    expect(failure.ok === false && failure.providerCodes).toEqual(["a"]);
  });

  it("refuses message text, too many codes, bad retry-after, a misplaced quota period and unknown reasons", () => {
    expect(() =>
      emailProviderFailure("rejected", { providerCodes: ["The address a@b.test is invalid"] }),
    ).toThrow(RangeError);
    expect(() =>
      emailProviderFailure("rejected", { providerCodes: Array.from({ length: 11 }, () => "x") }),
    ).toThrow(RangeError);
    for (const retryAfterSeconds of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => emailProviderFailure("rate_limited", { retryAfterSeconds })).toThrow(RangeError);
    }
    expect(() => emailProviderFailure("rate_limited", { quotaPeriod: "daily" })).toThrow(
      RangeError,
    );
    expect(() =>
      emailProviderFailure("quota_exceeded", { quotaPeriod: "weekly" as "daily" }),
    ).toThrow(RangeError);
    expect(() => emailProviderFailure("gone" as "rejected")).toThrow(RangeError);
  });
});
