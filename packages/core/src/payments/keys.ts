import {
  PAYMENT_LIMITS,
  PAYMENT_PROVIDER_CODE_PATTERN,
  PROVIDER_PAYMENT_ID_PATTERN,
} from "./limits.js";
import type { ProviderPaymentFact, ProviderRefundFact } from "./provider-port.js";
import { isProviderPaymentFact } from "./fact.js";

/*
 * Reference and dedupe key builders (ADR 0032 decisions 5, 7 and 12). Core never hashes: the API passes the SHA-256 of
 * the raw webhook body, and a SHA-256 function (`node:crypto`) for the refund list of a polled fact, like the HMAC port
 * of ADR 0023 / 0031.
 */

/** A function that answers the lower-case hex SHA-256 of a UTF-8 text (the API passes `node:crypto`). */
export type Sha256Hex = (text: string) => string;

const SHA256_HEX = /^[0-9a-f]{64}$/;

function assertSha(value: unknown): asserts value is string {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) {
    throw new RangeError("A SHA-256 digest is 64 lower-case hex characters");
  }
}

/**
 * The markPaid reference of an online payment (`sales_order.payment_reference`, decision 7): `<provider>:<providerPaymentId>`.
 * `markPaidIn` is idempotent by it. A malformed code or id is a bug (RangeError).
 */
export function buildProviderReference(providerCode: string, providerPaymentId: string): string {
  if (typeof providerCode !== "string" || !PAYMENT_PROVIDER_CODE_PATTERN.test(providerCode)) {
    throw new RangeError(`Not a payment provider code: ${String(providerCode)}`);
  }
  if (
    typeof providerPaymentId !== "string" ||
    !PROVIDER_PAYMENT_ID_PATTERN.test(providerPaymentId)
  ) {
    throw new RangeError("Not a provider payment id");
  }
  const reference = `${providerCode}:${providerPaymentId}`;
  if (reference.length > PAYMENT_LIMITS.providerReferenceMaxLength) {
    throw new RangeError("The provider reference is too long");
  }
  return reference;
}

/** `payment_event.dedupe_key` of a webhook: `webhook:<sha256 hex of the raw body>` (a replayed body is a duplicate). */
export function buildWebhookDedupeKey(rawBodySha256Hex: string): string {
  assertSha(rawBodySha256Hex);
  return `webhook:${rawBodySha256Hex}`;
}

function refundLine(refund: ProviderRefundFact): string {
  return [
    refund.refundId ?? "",
    refund.status,
    String(refund.amount.amount),
    refund.modifiedAt.toISOString(),
  ].join("|");
}

/**
 * The refund list as one text that does not depend on the provider's order: one line per refund
 * (`refundId|status|amount|modifiedAt`, an empty id for a refund made elsewhere), sorted, joined by `\n`.
 */
export function refundListCanonicalText(refunds: readonly ProviderRefundFact[]): string {
  return refunds.map(refundLine).sort().join("\n");
}

/**
 * `payment_event.dedupe_key` of a polled fact: `poll:<providerStatus>:<modifiedAt ISO>:<finalAmount|null>:<sha256 of the
 * refund list>`. Two reads that say the same thing are one journal row; a change of the status, the time, the final
 * amount or the refund list is a new row. A malformed fact or a digest that is not SHA-256 hex is a bug (RangeError).
 */
export function buildPollDedupeKey(fact: ProviderPaymentFact, sha256Hex: Sha256Hex): string {
  if (!isProviderPaymentFact(fact)) {
    throw new RangeError("buildPollDedupeKey needs a well-formed provider fact");
  }
  const digest = sha256Hex(refundListCanonicalText(fact.refunds));
  assertSha(digest);
  const final = fact.finalAmount === null ? "null" : String(fact.finalAmount.amount);
  return `poll:${fact.providerStatus}:${fact.modifiedAt.toISOString()}:${final}:${digest}`;
}
