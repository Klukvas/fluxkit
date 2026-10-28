/*
 * Payment variables of the API (ADR 0032 decision 16): `PAYMENT_PROVIDERS_ENABLED`. This package does not depend on
 * `@fluxkit/core`, so the provider code pattern and the invoice window are repeated here and a spec in `apps/api`
 * (`payment-config-parity.spec.ts`) asserts they equal core's `PAYMENT_PROVIDER_CODE_PATTERN` and `PAYMENT_INVOICE_WINDOW`.
 * A provider's own variables (`MONOBANK_TOKEN`) are NOT read here: each provider package parses its own (a missing token
 * stops the startup from inside the provider's module). No message of this file contains a value, only the variable name
 * and a reason.
 */

/** The shape of a payment provider code. Repeated from core `PAYMENT_PROVIDER_CODE_PATTERN` (the shared `CODE_PATTERN`). */
export const PAYMENT_PROVIDER_CODE = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Provider codes that exist for tests only (`packages/providers/_fake-payment`: an in-memory provider that charges
 * nothing). `loadEnv` refuses them when `NODE_ENV` is production, so a shop can never "take" a payment that no bank saw.
 */
export const TEST_ONLY_PAYMENT_PROVIDERS: readonly string[] = Object.freeze(["fake"]);

/**
 * Shortest `ORDER_PAYMENT_TTL_MINUTES` with a payment provider enabled. The invoice ends 3 minutes before the order
 * deadline and must leave the shopper at least 5 minutes (core `PAYMENT_INVOICE_WINDOW`: `marginMinutes` +
 * `minimumMinutes`), so with a shorter order time no order can ever be paid online. `loadEnv` refuses to start instead of
 * running a shop whose payment button never works (payments plan step 2, decision (e)).
 */
export const MIN_ORDER_PAYMENT_TTL_MINUTES_WITH_PAYMENT_PROVIDER = 8;

export type PaymentProvidersParse =
  | { readonly ok: true; readonly codes: string[] }
  | { readonly ok: false; readonly problem: string };

const CODE_RULE =
  "lowercase letters, digits and underscores, starting with a letter, at most 64 characters";

/**
 * Parses the comma-separated `PAYMENT_PROVIDERS_ENABLED` value. Unset, empty and blank mean no online payment (the
 * default). Strict, unlike a convenience list: spaces around an entry are ignored, but an empty entry, a code that is
 * not written exactly (upper case is not folded to lower case), or a code listed twice is a refusal, so a typo never
 * silently turns a payment provider off. The problem names the rule, never the entry.
 */
export function parsePaymentProvidersVariable(raw: string | undefined): PaymentProvidersParse {
  if (raw === undefined || raw.trim() === "") {
    return { ok: true, codes: [] };
  }
  const codes = raw.split(",").map((part) => part.trim());
  if (codes.some((code) => code === "")) {
    return {
      ok: false,
      problem: "must be a comma-separated list of provider codes without an empty entry",
    };
  }
  if (codes.some((code) => !PAYMENT_PROVIDER_CODE.test(code))) {
    return {
      ok: false,
      problem: `each entry must be a provider code (${CODE_RULE}); a code is written exactly, upper case is not accepted`,
    };
  }
  if (new Set(codes).size !== codes.length) {
    return { ok: false, problem: "must not list a provider code twice" };
  }
  return { ok: true, codes };
}
