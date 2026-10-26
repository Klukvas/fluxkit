import type { OrderStatus } from "../orders/status.js";
import type { PaymentCreated, PaymentProviderResult } from "./provider-port.js";
import { invoiceValidity } from "./validity.js";
import { isLivePaymentStatus, PAYMENT_STATUSES, type PaymentStatus } from "./status.js";

/*
 * Attempt rules (ADR 0032 decisions 5, 6 and 10): at most one live attempt per order, `create_unknown` is never retried,
 * and the guard that cancel and manual mark paid share. The API asks them under the order row lock with every attempt of
 * the order.
 */

export interface AttemptSummary {
  readonly id: string;
  readonly status: PaymentStatus;
}

function assertStatuses(attempts: readonly AttemptSummary[]): void {
  for (const attempt of attempts) {
    if (!PAYMENT_STATUSES.includes(attempt.status)) {
      throw new RangeError(`Unknown payment status: ${String(attempt.status)}`);
    }
  }
}

/** Live attempts that block a new attempt, a cancel or a manual mark paid: every live one but `awaiting_customer`. */
function blocking(attempts: readonly AttemptSummary[]): boolean {
  return attempts.some(
    (attempt) => isLivePaymentStatus(attempt.status) && attempt.status !== "awaiting_customer",
  );
}

function openIds(attempts: readonly AttemptSummary[]): readonly string[] {
  return Object.freeze(
    attempts
      .filter((attempt) => attempt.status === "awaiting_customer")
      .map((attempt) => attempt.id),
  );
}

export type NewAttemptDecision =
  | {
      readonly ok: true;
      /** `awaiting_customer` attempts to close `invalidated` in the same transaction (their invoices after commit). */
      readonly invalidate: readonly string[];
      readonly expiresAt: Date;
      readonly validitySeconds: number;
    }
  | {
      readonly ok: false;
      readonly rule:
        | "order_not_payable"
        | "payment_in_progress"
        | "payment_window_too_short"
        | "payment_not_available";
    };

/**
 * A new attempt for an order (decision 6), checked in the ADR's order:
 * - `order_not_payable`: the order is not `awaiting_payment`, or an attempt already `succeeded` (money was taken for this
 *   order; another payment would be a duplicate; an admin settles it);
 * - `payment_in_progress`: an attempt is `processing`, `create_unknown` (never retried, M5; ADR 0032 open question 1 kept
 *   as planned: blocked until job 11 closes it) or `creating` (a concurrent create);
 * - `payment_window_too_short`: `invoiceValidity` refuses;
 * - `payment_not_available`: no enabled provider takes the order currency (`providerAvailable` false).
 * An allowed attempt closes every `awaiting_customer` attempt, so at most one stays live.
 */
export function decideNewPaymentAttempt(input: {
  readonly orderStatus: OrderStatus;
  readonly attempts: readonly AttemptSummary[];
  readonly providerAvailable: boolean;
  readonly now: Date;
  readonly orderExpiresAt: Date;
}): NewAttemptDecision {
  assertStatuses(input.attempts);
  if (
    input.orderStatus !== "awaiting_payment" ||
    input.attempts.some((attempt) => attempt.status === "succeeded")
  ) {
    return Object.freeze({ ok: false as const, rule: "order_not_payable" as const });
  }
  if (blocking(input.attempts)) {
    return Object.freeze({ ok: false as const, rule: "payment_in_progress" as const });
  }
  const validity = invoiceValidity({ now: input.now, orderExpiresAt: input.orderExpiresAt });
  if (!validity.ok) {
    return Object.freeze({ ok: false as const, rule: "payment_window_too_short" as const });
  }
  if (!input.providerAvailable) {
    return Object.freeze({ ok: false as const, rule: "payment_not_available" as const });
  }
  return Object.freeze({
    ok: true as const,
    invalidate: openIds(input.attempts),
    expiresAt: validity.expiresAt,
    validitySeconds: validity.validitySeconds,
  });
}

export type OrderPaymentGuard =
  | { readonly ok: true; readonly invalidate: readonly string[] }
  | { readonly ok: false; readonly rule: "payment_in_progress" };

/**
 * The guard of a cancel (by the owner or an admin) of an `awaiting_payment` order and of a manual mark paid (decision 10,
 * owner answer 3): refused `payment_in_progress` while an attempt is `processing`; also while one is `create_unknown`
 * (ADR 0032 open question 2: the proposal, refuse like `processing`, adopted here; step 6 may revisit it) or `creating`
 * (the provider call is in flight). Otherwise allowed, and every `awaiting_customer` attempt is closed `invalidated` in
 * the same transaction (its invoice invalidated after commit; a success that still lands is refunded automatically).
 */
export function decideOrderPaymentGuard(attempts: readonly AttemptSummary[]): OrderPaymentGuard {
  assertStatuses(attempts);
  if (blocking(attempts)) {
    return Object.freeze({ ok: false as const, rule: "payment_in_progress" as const });
  }
  return Object.freeze({ ok: true as const, invalidate: openIds(attempts) });
}

export interface CreateRecord {
  readonly status: Extract<PaymentStatus, "awaiting_customer" | "failed" | "create_unknown">;
  /** The first provider code (or the reason) of a refusal. */
  readonly failureCode: string | null;
}

/**
 * What a `creating` attempt becomes after `createPayment` answered (decision 6 step 4). `ok`: `awaiting_customer`.
 * `rejected`, `misconfigured`, `not_sent` and `rate_limited` (a throttled request was not processed): `failed`, and the
 * shopper may try again at once. `unavailable` (the API maps a timeout, a thrown error and a malformed answer to it) and
 * answers that make no sense for a create: `create_unknown`, never retried with the same attempt (M5).
 */
export function paymentStatusAfterCreate(
  result: PaymentProviderResult<PaymentCreated>,
): CreateRecord {
  if (result.ok) {
    return Object.freeze({ status: "awaiting_customer" as const, failureCode: null });
  }
  switch (result.reason) {
    case "rejected":
    case "misconfigured":
    case "not_sent":
    case "rate_limited":
      return Object.freeze({
        status: "failed" as const,
        failureCode: result.providerCodes[0] ?? result.reason,
      });
    case "unavailable":
    case "not_found":
    case "not_cancellable":
    case "invalid_signature":
      return Object.freeze({ status: "create_unknown" as const, failureCode: null });
  }
}
