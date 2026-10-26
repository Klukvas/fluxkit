import type { Money } from "../pricing/money.js";
import type { ProviderAbortSignal } from "../shipping/provider-port.js";
import { PAYMENT_CODE_PATTERN, PAYMENT_LIMITS, PAYMENT_PROVIDER_CODE_PATTERN } from "./limits.js";

/*
 * The payment provider port (ADR 0032 decision 3; the ADR 0029 / 0031 pattern). Types and constants only, so a provider
 * package in `packages/providers/<code>` implements it without importing `apps/api`, and core never imports a provider
 * (dependency-cruiser `core-must-not-import-providers`). Internal until the first external plugin, then listed in
 * `docs/contracts/`. The members are exactly those of decision 3; plan step 2 fixed the exact types.
 *
 * Rules every provider follows:
 * - Money crosses the port in minor units with a currency; never a float, never a decimal string.
 * - A failure carries CODES only (`paymentProviderFailure` checks them), never the provider's message text (`errText`).
 * - `not_sent` is answered only when the provider can PROVE nothing left the process. `unavailable`, a timeout, a thrown
 *   error and a malformed answer MAY have reached the provider: a create becomes `create_unknown`, a refund `unknown`,
 *   and neither is retried blindly (decision 13).
 * - The API, not the provider, decides the timeout (`PAYMENT_PROVIDER_TIMEOUT_MS`, through the abort signal), logging and
 *   retries. A provider honours the signal and never logs a request or response body, the token or card data.
 * - A provider only normalises fields (`ProviderPaymentFact`); core maps provider statuses to attempt statuses
 *   (`normalizeProviderFact`) and decides everything else.
 * - Card data is the system and the last four digits only (question 12).
 */

/** Metadata key on the provider class inside a provider's Nest module (`SetMetadata`); the API finds it by discovery. */
export const PAYMENT_PROVIDER_METADATA = "fluxkit:payment-provider";

/** The `kind` a provider package declares: `"fluxkit": {"provider": "<code>", "kind": "payment"}` in `package.json`. */
export const PAYMENT_PROVIDER_PACKAGE_KIND = "payment";

export interface PaymentProviderMetadata {
  /** Equals the provider's `code`; the API refuses to start on a mismatch or a duplicate. */
  readonly code: string;
}

/** The value for `SetMetadata(PAYMENT_PROVIDER_METADATA, ...)`. A malformed code is a bug (RangeError). */
export function paymentProviderMetadata(code: string): PaymentProviderMetadata {
  if (typeof code !== "string" || !PAYMENT_PROVIDER_CODE_PATTERN.test(code)) {
    throw new RangeError(`Not a payment provider code: ${String(code)}`);
  }
  return Object.freeze({ code });
}

export const PAYMENT_PROVIDER_FAILURE_REASONS = Object.freeze([
  /** Network failure, timeout, 5xx, a malformed answer: the request MAY have reached the provider. */
  "unavailable",
  /** The provider throttles requests (Monobank `429 TMR`, M16): the request was not processed. */
  "rate_limited",
  /** The provider refused the request itself (a field, an amount, a rule). */
  "rejected",
  /** The token is missing, wrong or revoked (Monobank `403`): the operator must act. */
  "misconfigured",
  /** No such payment at the provider (`404`). */
  "not_found",
  /** The payment cannot be refunded or invalidated now (Monobank `CANCEL_NOT_AVAILABLE`). */
  "not_cancellable",
  /** `verifyWebhook` only: the signature does not verify over the raw body (or is missing). */
  "invalid_signature",
  /** Provably nothing left the process (local validation, an abort before the request). */
  "not_sent",
] as const);

export type PaymentProviderFailureReason = (typeof PAYMENT_PROVIDER_FAILURE_REASONS)[number];

export interface PaymentProviderFailure {
  readonly ok: false;
  readonly reason: PaymentProviderFailureReason;
  /** Raw provider codes (`PAYMENT_CODE_PATTERN`), never message text. May be empty. */
  readonly providerCodes: readonly string[];
  /** The provider's `Retry-After`, in whole seconds, when it sent one (M17: UNKNOWN whether Monobank does). */
  readonly retryAfterSeconds?: number;
}

export type PaymentProviderResult<T> =
  { readonly ok: true; readonly value: T } | PaymentProviderFailure;

export function paymentProviderOk<T>(value: T): PaymentProviderResult<T> {
  return Object.freeze({ ok: true as const, value });
}

/**
 * A typed failure. Each code must match `PAYMENT_CODE_PATTERN` (short, no spaces), so a provider's message text cannot be
 * passed as a code; a bad reason, a bad code, more than `PAYMENT_LIMITS.maxProviderCodes` codes or a `retryAfterSeconds`
 * that is not a non-negative whole number is a bug in the provider (RangeError).
 */
export function paymentProviderFailure(
  reason: PaymentProviderFailureReason,
  details: { readonly providerCodes?: readonly string[]; readonly retryAfterSeconds?: number } = {},
): PaymentProviderFailure {
  if (!PAYMENT_PROVIDER_FAILURE_REASONS.includes(reason)) {
    throw new RangeError(`Unknown payment provider failure reason: ${String(reason)}`);
  }
  const providerCodes = details.providerCodes ?? [];
  if (!Array.isArray(providerCodes) || providerCodes.length > PAYMENT_LIMITS.maxProviderCodes) {
    throw new RangeError(
      `A payment provider failure carries at most ${String(PAYMENT_LIMITS.maxProviderCodes)} codes`,
    );
  }
  for (const code of providerCodes) {
    if (typeof code !== "string" || !PAYMENT_CODE_PATTERN.test(code)) {
      throw new RangeError("A payment provider failure code must be a short code, not a message");
    }
  }
  const { retryAfterSeconds } = details;
  if (
    retryAfterSeconds !== undefined &&
    !(Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds >= 0)
  ) {
    throw new RangeError("retryAfterSeconds must be a non-negative whole number of seconds");
  }
  return Object.freeze({
    ok: false as const,
    reason,
    providerCodes: Object.freeze([...providerCodes]),
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  });
}

/**
 * A provider's payment status, normalised by the plugin (decision 15 maps Monobank's: `success` -> `succeeded`,
 * `failure` -> `failed`, `hold` -> `authorized`, the others as named). `authorized` is for later hold support; no v1 flow
 * produces it.
 */
export const PROVIDER_PAYMENT_STATUSES = Object.freeze([
  "created",
  "processing",
  "authorized",
  "succeeded",
  "failed",
  "reversed",
  "expired",
] as const);

export type ProviderPaymentStatus = (typeof PROVIDER_PAYMENT_STATUSES)[number];

/** A refund's status as the provider reports it (Monobank `cancelList[].status`, `invoice/cancel` answer). */
export const PROVIDER_REFUND_STATUSES = Object.freeze([
  "processing",
  "succeeded",
  "failed",
] as const);

export type ProviderRefundStatus = (typeof PROVIDER_REFUND_STATUSES)[number];

/** One refund the provider lists for a payment. */
export interface ProviderRefundFact {
  /** Our refund id as sent (`extRef`), `null` for a refund made elsewhere (the merchant cabinet). */
  readonly refundId: string | null;
  readonly status: ProviderRefundStatus;
  /** Positive, in the payment's currency. */
  readonly amount: Money;
  readonly modifiedAt: Date;
}

/**
 * What the provider says about one payment, from a verified webhook or a status read (decision 7: both equally trusted).
 * Plan step 2 fixed one detail of decision 3's sketch: `status` is `null` when the provider sent a status the plugin
 * does not know (`providerStatus` keeps it); core then changes nothing and raises attention (like a shipping
 * `TrackingUpdate`).
 */
export interface ProviderPaymentFact {
  /** `PROVIDER_PAYMENT_ID_PATTERN` (Monobank `invoiceId`). */
  readonly providerPaymentId: string;
  /** What we sent as the reference: the attempt id (decision 5). */
  readonly reference: string;
  readonly status: ProviderPaymentStatus | null;
  /** The raw provider status (`PAYMENT_PROVIDER_STATUS_PATTERN`). */
  readonly providerStatus: string;
  /** Positive, in minor units. */
  readonly amount: Money;
  /** The provider's final amount (Monobank `finalAmount`) in the amount's currency, `null` until known. */
  readonly finalAmount: Money | null;
  /** The provider's change time (Monobank `modifiedDate`): the greater one is current (M10). */
  readonly modifiedAt: Date;
  /** The provider's error code (`PAYMENT_CODE_PATTERN`), never its text. */
  readonly failureCode: string | null;
  /** At most `PAYMENT_LIMITS.maxFactRefunds`. */
  readonly refunds: readonly ProviderRefundFact[];
  readonly card: { readonly system: string; readonly last4: string } | null;
}

/** One line of the provider's basket (Monobank `basketOrder`), built by `buildPaymentLines`. */
export interface PaymentLine {
  readonly name: string;
  readonly quantity: number;
  readonly unitAmount: Money;
  readonly total: Money;
  /** The SKU, or the shipping method code. */
  readonly code: string | null;
}

export interface CreatePaymentInput {
  /** The attempt id (`payment.id`), sent as the provider reference. */
  readonly paymentId: string;
  readonly orderNumber: string;
  readonly amount: Money;
  /** Localized, at most `PAYMENT_LIMITS.descriptionMaxLength` code points. */
  readonly description: string;
  readonly lines: readonly PaymentLine[];
  /** Built from `STOREFRONT_PUBLIC_URL` only (decision 14). */
  readonly returnUrl: string;
  readonly webhookUrl: string;
  /** The invoice validity end (`invoiceValidity`). */
  readonly expiresAt: Date;
}

export interface PaymentCreated {
  readonly providerPaymentId: string;
  /** The hosted payment page: `https` on the plugin's allow-listed host (decision 14). */
  readonly redirectUrl: string;
}

export interface RefundInput {
  readonly providerPaymentId: string;
  /** Our refund id (`payment_refund.id`), sent as the idempotency reference (Monobank `extRef`). */
  readonly refundId: string;
  readonly amount: Money;
  /** The whole payment amount (no earlier refund). */
  readonly full: boolean;
}

/** The exact bytes received and the request headers (lower-case names). */
export interface PaymentWebhookInput {
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody: Uint8Array;
}

export interface PaymentProviderCapabilities {
  /** The ISO 4217 codes the provider takes; the API refuses to start when `SHOP_CURRENCY` is missing (`monobank`: UAH). */
  readonly currencies: readonly string[];
  readonly partialRefunds: boolean;
  readonly multipleRefunds: boolean;
  /** Whether an unpaid invoice can be invalidated (Monobank `invoice/remove`, M14). */
  readonly invalidateUnpaid: boolean;
  readonly webhooks: boolean;
}

export interface PaymentProviderPort {
  /** Matches `PAYMENT_PROVIDER_CODE_PATTERN`, e.g. `monobank`. */
  readonly code: string;
  readonly capabilities: PaymentProviderCapabilities;
  /** Never retried by the API with the same attempt (Monobank has no create idempotency, M5). */
  createPayment(
    input: CreatePaymentInput,
    signal: ProviderAbortSignal,
  ): Promise<PaymentProviderResult<PaymentCreated>>;
  getPayment(
    providerPaymentId: string,
    signal: ProviderAbortSignal,
  ): Promise<PaymentProviderResult<ProviderPaymentFact>>;
  invalidatePayment(
    providerPaymentId: string,
    signal: ProviderAbortSignal,
  ): Promise<PaymentProviderResult<{ invalidated: boolean }>>;
  /**
   * A lost answer is never resent: the refund becomes `unknown` and is settled from `getPayment`'s `refunds` by our
   * `refundId` (decision 13).
   */
  refund(
    input: RefundInput,
    signal: ProviderAbortSignal,
  ): Promise<PaymentProviderResult<{ status: ProviderRefundStatus }>>;
  /** Verifies the signature over the exact raw bytes first; `invalid_signature` when it does not verify. */
  verifyWebhook(
    input: PaymentWebhookInput,
    signal: ProviderAbortSignal,
  ): Promise<PaymentProviderResult<ProviderPaymentFact>>;
}
