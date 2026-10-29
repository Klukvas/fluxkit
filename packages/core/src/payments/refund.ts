import type { Money } from "../pricing/money.js";
import { MAX_AMOUNT } from "../pricing/limits.js";
import { assertPositiveMoney } from "./guards.js";
import {
  PROVIDER_REFUND_STATUSES,
  type PaymentProviderResult,
  type ProviderPaymentFact,
  type ProviderRefundFact,
  type ProviderRefundStatus,
} from "./provider-port.js";
import type { PaymentAttentionCode } from "./reasons.js";
import {
  decideRefundTransition,
  PAYMENT_STATUSES,
  REFUND_ACTIVE_STATUSES,
  REFUND_STATUSES,
  type PaymentStatus,
  type RefundStatus,
} from "./status.js";

/*
 * Refund rules (ADR 0032 decisions 11 and 13; owner answer 3). Money in integer minor units only. A refund never changes
 * the order status. The API takes the payment row lock, calls `decideRefund` with every refund row of the payment,
 * inserts the new row `requested`, calls the provider with no transaction open and records `refundStatusAfterCall`.
 * The idempotency reference sent to the provider (Monobank `extRef`) is the refund row's id (decision 5), so a lost
 * answer is settled by `decideRefundFromFact`, never by a second call.
 */

/** A stored refund of the payment (any status). */
export interface RefundRecord {
  readonly amount: Money;
  readonly status: RefundStatus;
  /**
   * A `succeeded` refund that an applied provider fact listed `succeeded` (`payment_refund.provider_modified_at` set), so
   * the stored final amount already shows it. Absent or `false`: the stored final amount may predate it. Only
   * `refundableAmount` reads it.
   */
  readonly inFinalAmount?: boolean;
}

export interface RefundCapabilities {
  readonly partialRefunds: boolean;
  readonly multipleRefunds: boolean;
}

function isActive(status: RefundStatus): boolean {
  if (!REFUND_STATUSES.includes(status)) {
    throw new RangeError(`Unknown refund status: ${String(status)}`);
  }
  return (REFUND_ACTIVE_STATUSES as readonly RefundStatus[]).includes(status);
}

/**
 * The amount still refundable: `amount` less every `requested`, `processing`, `succeeded` and `unknown` refund (a
 * `failed` refund frees its amount again). Stored refunds in another currency or above the amount are corrupt data
 * (RangeError): the CHECK and the payment row lock keep them within it.
 */
export function remainingRefundable(amount: Money, refunds: readonly RefundRecord[]): Money {
  assertPositiveMoney(amount, "payment amount");
  let active = 0;
  for (const refund of refunds) {
    assertPositiveMoney(refund.amount, "refund amount");
    if (refund.amount.currency !== amount.currency) {
      throw new RangeError("A refund is in another currency than its payment");
    }
    if (isActive(refund.status)) {
      active += refund.amount.amount;
    }
  }
  if (active > amount.amount) {
    throw new RangeError("Stored refunds exceed the payment amount");
  }
  return Object.freeze({ amount: amount.amount - active, currency: amount.currency });
}

/** A stored refund of ours with its id (sent to the provider as the refund's reference, Monobank `extRef`). */
export interface IdentifiedRefundRecord extends RefundRecord {
  readonly id: string;
}

/** A provider's final amount: whole minor units from 0 to the amount, in its currency; anything else is corrupt. */
function assertFinalAmount(amount: Money, finalAmount: Money): void {
  if (
    typeof finalAmount !== "object" ||
    finalAmount === null ||
    !Number.isSafeInteger(finalAmount.amount) ||
    finalAmount.amount < 0 ||
    finalAmount.amount > amount.amount ||
    finalAmount.currency !== amount.currency
  ) {
    throw new RangeError("A final amount must be 0 to the payment amount, in its currency");
  }
}

/**
 * What the shop may still refund (review F1 of 2026-10-29): `remainingRefundable` less the money the provider returned
 * outside the shop, so the same money is never refunded twice and nothing above what the provider still holds is
 * offered. The external part comes from the stored final amount (Monobank `finalAmount`, what the provider holds after
 * every refund it made): `amount - finalAmount - our succeeded refunds it already shows` (`inFinalAmount`), at least 0.
 * A refund of ours the stored final amount does not show yet is counted once, by `remainingRefundable`. Without a refund
 * made elsewhere the answer is exactly `remainingRefundable`; `finalAmount` `null` (not reported) changes nothing. Never
 * below 0. A final amount outside 0 to the amount or in another currency is corrupt data (RangeError).
 */
export function refundableAmount(input: {
  readonly amount: Money;
  readonly finalAmount: Money | null;
  readonly refunds: readonly RefundRecord[];
}): Money {
  const remaining = remainingRefundable(input.amount, input.refunds);
  if (input.finalAmount === null) {
    return remaining;
  }
  assertFinalAmount(input.amount, input.finalAmount);
  let shown = 0;
  for (const refund of input.refunds) {
    if (refund.status === "succeeded" && refund.inFinalAmount === true) {
      shown += refund.amount.amount;
    }
  }
  const external = Math.max(0, input.amount.amount - input.finalAmount.amount - shown);
  return Object.freeze({
    amount: Math.max(0, remaining.amount - external),
    currency: remaining.currency,
  });
}

/**
 * Money returned to the payer that our own refunds do not explain (a refund made in the provider's cabinet). Two views
 * of the same money, so the larger one counts, never their sum:
 * - the final amount: `amount - finalAmount - our requested/processing/succeeded/unknown refunds`, at least 0;
 * - the provider's refund list: every entry that is not `failed` without our refund id, or with an id that is not one
 *   of ours (an external refund still `processing` shows here before the final amount drops).
 * Capped at the amount. A list or final amount in another currency is corrupt (RangeError; `bindFact` refuses such a
 * fact first).
 */
export function externalRefundAmount(input: {
  readonly amount: Money;
  readonly finalAmount: Money | null;
  readonly refunds: readonly IdentifiedRefundRecord[];
  readonly listed: readonly ProviderRefundFact[];
}): Money {
  const { amount } = input;
  const ourActive = amount.amount - remainingRefundable(amount, input.refunds).amount;
  let fromFinal = 0;
  if (input.finalAmount !== null) {
    assertFinalAmount(amount, input.finalAmount);
    fromFinal = Math.max(0, amount.amount - input.finalAmount.amount - ourActive);
  }
  const ourIds = new Set(input.refunds.map((refund) => refund.id));
  let fromList = 0;
  for (const entry of input.listed) {
    if (entry.amount.currency !== amount.currency) {
      throw new RangeError("A listed refund is in another currency than its payment");
    }
    if (entry.status !== "failed" && (entry.refundId === null || !ourIds.has(entry.refundId))) {
      fromList += entry.amount.amount;
    }
  }
  return Object.freeze({
    amount: Math.min(amount.amount, Math.max(fromFinal, fromList)),
    currency: amount.currency,
  });
}

export interface ExternalRefundDecision {
  readonly externalAmount: Money;
  /** `external_reversal` when the fact shows more external money than the stored final amount did, else `null`. */
  readonly attentionCode: Extract<PaymentAttentionCode, "external_reversal"> | null;
}

/**
 * Whether a bound, applied fact shows a refund made outside the shop (review F1 of 2026-10-29). Attention
 * `external_reversal` (a refund made outside the shop, the existing code; no new code or CHECK) when the external amount
 * of the fact (`externalRefundAmount` with its final amount and refund list) is greater than the one the previously
 * stored final amount already showed, so a later fact about the same external refund does not raise it again once an
 * admin cleared it. `refunds`: our refunds after the fact settled them. A fact in another currency is a bug (RangeError).
 */
export function decideExternalRefund(input: {
  readonly amount: Money;
  /** `payment.final_amount` before this fact; `null` when no fact reported one yet. */
  readonly previousFinalAmount: Money | null;
  readonly refunds: readonly IdentifiedRefundRecord[];
  readonly fact: ProviderPaymentFact;
}): ExternalRefundDecision {
  assertPositiveMoney(input.amount, "payment amount");
  if (
    input.fact.amount.currency !== input.amount.currency ||
    (input.fact.finalAmount !== null && input.fact.finalAmount.currency !== input.amount.currency)
  ) {
    throw new RangeError("A fact is in another currency than its payment");
  }
  const now = externalRefundAmount({
    amount: input.amount,
    finalAmount: input.fact.finalAmount,
    refunds: input.refunds,
    listed: input.fact.refunds,
  });
  const before = externalRefundAmount({
    amount: input.amount,
    finalAmount: input.previousFinalAmount,
    refunds: input.refunds,
    listed: [],
  });
  return Object.freeze({
    externalAmount: now,
    attentionCode: now.amount > before.amount ? ("external_reversal" as const) : null,
  });
}

export type RefundRefusal =
  | "invalid_amount"
  | "currency_mismatch"
  | "refund_not_allowed"
  | "refund_exceeds_remaining"
  | "partial_refund_not_supported";

export type RefundDecision =
  | {
      readonly ok: true;
      /** The whole payment amount with no earlier refund (the port's `full`). */
      readonly full: boolean;
      readonly remainingAfter: Money;
    }
  | { readonly ok: false; readonly reason: RefundRefusal };

function refuse(reason: RefundRefusal): RefundDecision {
  return Object.freeze({ ok: false as const, reason });
}

/**
 * Checks in this order: the requested amount is a whole number of minor units from 1 to `MAX_AMOUNT` (`invalid_amount`,
 * the API's `400 validation_failed`), in the payment's currency (`currency_mismatch`, also a `400`); the payment
 * `succeeded` and, when the provider takes only one refund per payment, has no active refund (`refund_not_allowed`);
 * `0 < amount <= refundableAmount` (`refund_exceeds_remaining`: exactly the remaining amount is allowed, one minor unit
 * more is not, and nothing after a full refund; the provider's final amount caps it, so money already returned outside
 * the shop is never refunded a second time); a partial amount only when the provider allows partial refunds
 * (`partial_refund_not_supported`; PRRO is not linked in v1, so no fiscal items are required, decision 1).
 * Corrupt payment data throws a RangeError.
 */
export function decideRefund(input: {
  readonly payment: {
    readonly status: PaymentStatus;
    readonly amount: Money;
    /** `payment.final_amount` (the provider's view); absent or `null`: not reported, no cap. */
    readonly finalAmount?: Money | null;
  };
  readonly refunds: readonly RefundRecord[];
  readonly amount: Money;
  readonly capabilities: RefundCapabilities;
}): RefundDecision {
  const { payment, amount } = input;
  if (!PAYMENT_STATUSES.includes(payment.status)) {
    throw new RangeError(`Unknown payment status: ${String(payment.status)}`);
  }
  const remaining = refundableAmount({
    amount: payment.amount,
    finalAmount: payment.finalAmount ?? null,
    refunds: input.refunds,
  });
  if (
    typeof amount !== "object" ||
    amount === null ||
    !Number.isSafeInteger(amount.amount) ||
    amount.amount < 1 ||
    amount.amount > MAX_AMOUNT
  ) {
    return refuse("invalid_amount");
  }
  if (amount.currency !== payment.amount.currency) {
    return refuse("currency_mismatch");
  }
  if (payment.status !== "succeeded") {
    return refuse("refund_not_allowed");
  }
  const hasActive = input.refunds.some((refund) => isActive(refund.status));
  if (!input.capabilities.multipleRefunds && hasActive) {
    return refuse("refund_not_allowed");
  }
  if (amount.amount > remaining.amount) {
    return refuse("refund_exceeds_remaining");
  }
  const full = amount.amount === payment.amount.amount;
  if (!full && !input.capabilities.partialRefunds) {
    return refuse("partial_refund_not_supported");
  }
  return Object.freeze({
    ok: true as const,
    full,
    remainingAfter: Object.freeze({
      amount: remaining.amount - amount.amount,
      currency: remaining.currency,
    }),
  });
}

export interface RefundCallOutcome {
  /** `requested`: nothing happened (throttled); the row stays in job 11's queue. */
  readonly status: Extract<
    RefundStatus,
    "requested" | "processing" | "succeeded" | "failed" | "unknown"
  >;
  /** The first provider code (or the reason) of a refusal, for `payment_refund.failure_code`. */
  readonly failureCode: string | null;
  readonly attentionCode: Extract<PaymentAttentionCode, "refund_failed"> | null;
  readonly retryAfterSeconds: number | null;
}

function callOutcome(
  status: RefundCallOutcome["status"],
  failureCode: string | null,
  retryAfterSeconds: number | null = null,
): RefundCallOutcome {
  return Object.freeze({
    status,
    failureCode,
    attentionCode: status === "failed" ? ("refund_failed" as const) : null,
    retryAfterSeconds,
  });
}

/**
 * What the refund row becomes after the provider call (decision 11; the "unknown outcome" rule of decision 13):
 * - `ok`: the provider's status.
 * - `unavailable` (a timeout, a thrown error and a malformed answer are mapped to it by the API) and any answer that
 *   makes no sense for a refund (`invalid_signature`): `unknown`. Never resent; job 11 settles it from the provider's
 *   refund list (`decideRefundFromFact`), and the reconcile schedule ends in `reconcile_gave_up`, never in `failed`.
 * - `rate_limited`: stays `requested` (the request was not processed); job 11 sends it after `retryAfterSeconds`.
 * - `not_sent`, `rejected`, `misconfigured`, `not_found`, `not_cancellable`: nothing was refunded: `failed` with
 *   attention `refund_failed` (its amount is refundable again; an admin decides).
 */
export function refundStatusAfterCall(
  result: PaymentProviderResult<{ readonly status: ProviderRefundStatus }>,
): RefundCallOutcome {
  if (result.ok) {
    if (!PROVIDER_REFUND_STATUSES.includes(result.value.status)) {
      throw new RangeError(`Unknown provider refund status: ${String(result.value.status)}`);
    }
    return callOutcome(result.value.status, null);
  }
  switch (result.reason) {
    case "unavailable":
    case "invalid_signature":
      return callOutcome("unknown", null);
    case "rate_limited":
      return callOutcome("requested", null, result.retryAfterSeconds ?? null);
    case "not_sent":
    case "rejected":
    case "misconfigured":
    case "not_found":
    case "not_cancellable":
      return callOutcome("failed", result.providerCodes[0] ?? result.reason);
  }
}

export type RefundFactDecision =
  | { readonly kind: "none" }
  | {
      readonly kind: "apply";
      readonly toStatus: RefundStatus;
      readonly attentionCode: Extract<PaymentAttentionCode, "refund_failed"> | null;
    }
  | {
      readonly kind: "attention";
      readonly attentionCode: Extract<PaymentAttentionCode, "refund_mismatch">;
    };

/**
 * Settles one of our refunds from a bound provider fact by our refund id (the provider's `refundId` / Monobank `extRef`):
 * - not listed: nothing changes (an `unknown` refund stays `unknown`; ADR 0032 open question 4: never failed
 *   automatically);
 * - listed twice, or with another amount: attention `refund_mismatch`, nothing changes;
 * - listed: the refund transition table decides with the `provider` actor (the same status, a terminal refund or a
 *   backward move changes nothing).
 */
export function decideRefundFromFact(
  refund: { readonly id: string; readonly status: RefundStatus; readonly amount: Money },
  fact: ProviderPaymentFact,
): RefundFactDecision {
  const entries = fact.refunds.filter((entry) => entry.refundId === refund.id);
  if (entries.length === 0) {
    return Object.freeze({ kind: "none" as const });
  }
  const [entry] = entries;
  if (
    entries.length > 1 ||
    entry === undefined ||
    entry.amount.amount !== refund.amount.amount ||
    entry.amount.currency !== refund.amount.currency
  ) {
    return Object.freeze({ kind: "attention" as const, attentionCode: "refund_mismatch" as const });
  }
  if (entry.status === refund.status) {
    return Object.freeze({ kind: "none" as const });
  }
  const decision = decideRefundTransition(refund.status, entry.status, "provider");
  if (!decision.ok) {
    return Object.freeze({ kind: "none" as const });
  }
  return Object.freeze({
    kind: "apply" as const,
    toStatus: entry.status,
    attentionCode: entry.status === "failed" ? ("refund_failed" as const) : null,
  });
}
