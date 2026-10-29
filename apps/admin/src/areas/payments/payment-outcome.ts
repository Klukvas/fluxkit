import type {
  AdminPaymentRefund,
  AdminRefundResult,
  Money,
  PaymentRefundStatus,
  ProblemDetails,
} from "@fluxkit/api-client";
import {
  describeFieldError,
  describeProblem,
  type MessageDescriptor,
} from "../../lib/problem-messages";

/**
 * How the order detail words what the payment routes answered (`docs/api/payments.md`, "Admin routes"). Pure. The API's
 * English `detail` is never shown; every text is a message of the payments file. A refund whose result is `unknown` or
 * `requested` is said as it is: the shop has not seen the money move, and the screen never sends it again by itself.
 */

/**
 * The refusals (`409 rule_violation`) of the admin payment routes that get an explanation of their own: what happened and
 * what to do instead. Every rule core names for payments has one (`payment-outcome.spec.ts` compares the lists).
 */
export const PAYMENT_REFUSAL_RULES = [
  "refund_not_allowed",
  "refund_exceeds_remaining",
  "partial_refund_not_supported",
  "payment_not_available",
  "payment_in_progress",
  "payment_window_too_short",
] as const;

/** Whole seconds of a `Retry-After` header, or `null` when it is missing or not a plausible wait. */
export function waitSeconds(header: string | null): number | null {
  if (header === null || !/^\d{1,4}$/.test(header)) return null;
  const seconds = Number(header);
  return seconds >= 1 && seconds <= 3600 ? seconds : null;
}

/**
 * A refusal of a payment route in words. A `503 payment_provider_unavailable` says nothing was changed and when to look
 * again; the same `Idempotency-Key` with another request is explained; everything else is the shell's problem map.
 */
export function describePaymentProblem(
  status: number,
  problem: ProblemDetails,
  retryAfter: string | null,
): MessageDescriptor {
  if (problem.code === "payment_provider_unavailable") {
    const seconds = waitSeconds(retryAfter);
    return seconds === null
      ? { key: "payments.unavailable" }
      : { key: "payments.unavailableRetry", values: { seconds } };
  }
  if (problem.code === "idempotency_key_reused") return { key: "payments.refusal.keyReused" };
  const rule = problem.code === "rule_violation" ? problem.rule : undefined;
  if (rule !== undefined && (PAYMENT_REFUSAL_RULES as readonly string[]).includes(rule)) {
    return { key: `payments.refusal.${rule}` };
  }
  return describeProblem(status, problem);
}

/** Codes of a `400` on the refund body that have a message of their own (the rest go through the shell's map). */
const REFUND_FIELD_CODES = ["invalid_amount", "currency_mismatch"] as const;

export function describeRefundFieldCode(code: string): MessageDescriptor {
  return (REFUND_FIELD_CODES as readonly string[]).includes(code)
    ? { key: `payments.field.${code}` }
    : describeFieldError(code);
}

export interface RefundFieldErrors {
  amount?: MessageDescriptor;
  note?: MessageDescriptor;
  other: MessageDescriptor[];
}

/** A `400` of the refund route on the form's fields (`amount`, `note`); what has no field goes to `other`. */
export function refundFieldErrors(problem: ProblemDetails): RefundFieldErrors {
  const found: RefundFieldErrors = { other: [] };
  for (const error of problem.errors ?? []) {
    const descriptor = describeRefundFieldCode(error.code);
    if (error.path === "amount" || error.path.startsWith("amount.")) {
      found.amount ??= descriptor;
    } else if (error.path === "note") {
      found.note ??= descriptor;
    } else {
      found.other.push(descriptor);
    }
  }
  return found;
}

/** What the status line says after an action on payments. */
export type PaymentNotice =
  | {
      kind: "refund";
      status: PaymentRefundStatus;
      amount: Money;
      /** The provider's code of a refused refund. */
      failureCode: string | null;
      /** `200`: the same request was answered before, nothing was sent now. */
      replay: boolean;
    }
  | { kind: "refundLost" }
  | { kind: "resynced"; at: string }
  | { kind: "resyncLost" }
  | { kind: "cleared" }
  | { kind: "clearLost" };

export function refundNotice(result: AdminRefundResult, httpStatus: number): PaymentNotice {
  const refund: AdminPaymentRefund = result.refund;
  return {
    kind: "refund",
    status: refund.status,
    amount: refund.amount,
    failureCode: refund.failureCode,
    replay: httpStatus === 200,
  };
}
