import { describe, expect, it } from "vitest";
import {
  MIN_ORDER_PAYMENT_TTL_MINUTES_WITH_PAYMENT_PROVIDER,
  PAYMENT_PROVIDER_CODE,
  parsePaymentProvidersVariable,
  TEST_ONLY_PAYMENT_PROVIDERS,
} from "@fluxkit/config";
import {
  ORDER_PAYMENT_TTL_MINUTES,
  PAYMENT_INVOICE_WINDOW,
  PAYMENT_PROVIDER_CODE_PATTERN,
} from "@fluxkit/core";

/*
 * `@fluxkit/config` does not depend on `@fluxkit/core`, so it repeats the payment provider code pattern and the shortest
 * order time that leaves room for an invoice. This spec fails when the copies drift from core.
 */

describe("PAYMENT_PROVIDERS_ENABLED: config and core agree", () => {
  it("the provider code pattern is the same", () => {
    expect(PAYMENT_PROVIDER_CODE.source).toBe(PAYMENT_PROVIDER_CODE_PATTERN.source);
    expect(PAYMENT_PROVIDER_CODE.flags).toBe(PAYMENT_PROVIDER_CODE_PATTERN.flags);
  });

  it.each(["fake", "monobank", "a", "a1_b2", `a${"b".repeat(63)}`])(
    "both accept the code %j",
    (code) => {
      expect(PAYMENT_PROVIDER_CODE_PATTERN.test(code)).toBe(true);
      expect(parsePaymentProvidersVariable(code)).toEqual({ ok: true, codes: [code] });
    },
  );

  it.each(["Fake", "1fake", "_fake", "mono-bank", "fa ke", "a".repeat(65), ""])(
    "both refuse the code %j",
    (code) => {
      expect(PAYMENT_PROVIDER_CODE_PATTERN.test(code)).toBe(false);
      expect(parsePaymentProvidersVariable(`monobank,${code}`).ok).toBe(false);
    },
  );

  it("the shortest order time with a provider is the invoice margin plus the minimum time to pay", () => {
    expect(MIN_ORDER_PAYMENT_TTL_MINUTES_WITH_PAYMENT_PROVIDER).toBe(
      PAYMENT_INVOICE_WINDOW.marginMinutes + PAYMENT_INVOICE_WINDOW.minimumMinutes,
    );
  });

  it("the order time bounds still admit the minimum, so the refusal is a real choice", () => {
    expect(ORDER_PAYMENT_TTL_MINUTES.min).toBeLessThan(
      MIN_ORDER_PAYMENT_TTL_MINUTES_WITH_PAYMENT_PROVIDER,
    );
    expect(ORDER_PAYMENT_TTL_MINUTES.max).toBeGreaterThanOrEqual(
      MIN_ORDER_PAYMENT_TTL_MINUTES_WITH_PAYMENT_PROVIDER,
    );
  });

  it("every test-only provider is a valid code", () => {
    for (const code of TEST_ONLY_PAYMENT_PROVIDERS) {
      expect(PAYMENT_PROVIDER_CODE_PATTERN.test(code)).toBe(true);
    }
  });
});
