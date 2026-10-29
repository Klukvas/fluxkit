import { PAYMENT_PROVIDER_TIMEOUT_MS } from "@fluxkit/core";

export const PAYMENTS_CONFIG = Symbol("fluxkit:payments-config");

/** What the payment flows read from the configuration (ADR 0032 decision 16). */
export interface PaymentsConfig {
  /** `STOREFRONT_PUBLIC_URL`: the ONLY base of the return and webhook URLs (never a request's `Host`); `null` when unset. */
  readonly storefrontPublicUrl: string | null;
  /** The time the API gives one provider call (decision 3: 10 s); specs pass less. */
  readonly providerTimeoutMs: number;
}

export const DEFAULT_PAYMENTS_CONFIG: PaymentsConfig = Object.freeze({
  storefrontPublicUrl: null,
  providerTimeoutMs: PAYMENT_PROVIDER_TIMEOUT_MS,
});

/**
 * Internal timings of the flows (ADR 0032 decisions 6, 11 and 13; not configuration, not a public contract).
 * - `createRecoveryMs`: a `creating` attempt whose create was not recorded within this time (the process died between
 *   the insert and the record) is closed `create_unknown` by job 11. Well above the provider timeout.
 * - `refundClaimStaleMs`: a refund send whose claim is older than this and has no recorded answer died mid-call; job 11
 *   marks the refund `unknown` and settles it from the provider's refund list, never by a second call.
 * - `invalidationTries`: invalidating a closed invoice is tried this often (decision 13: "once, failures retried twice").
 * - `rateLimitedRetryMs`: the wait after `rate_limited` when the provider names none.
 */
export const PAYMENT_TIMINGS = Object.freeze({
  createRecoveryMs: 2 * 60_000,
  refundClaimStaleMs: 2 * 60_000,
  invalidationTries: 3,
  rateLimitedRetryMs: 60_000,
});
