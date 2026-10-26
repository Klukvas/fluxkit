import { orderExpiresAt as normalOrderDeadline } from "../orders/expiry.js";
import { assertDate } from "./guards.js";
import { PAYMENT_EXPIRY_DEFERRAL } from "./limits.js";
import { isLivePaymentStatus, type PaymentStatus } from "./status.js";

/*
 * Expiry of an order while a payment is in flight (ADR 0032 decision 8, owner answer 2; core `decideExpiry`). Job 1 asks
 * it under the order row lock for an `awaiting_payment` order. Pure date arithmetic on UTC epoch milliseconds.
 */

const MINUTE_MS = 60_000;

export interface ExpiryAttempt {
  readonly id: string;
  readonly status: PaymentStatus;
}

export type ExpiryDecision =
  /** `now` is before the order's deadline: nothing to do. */
  | { readonly action: "not_due" }
  /**
   * Expire the order now. `capReached`: an attempt was still live, but the deadline is at the cap; a success that lands
   * later is refunded automatically (`decideOrderOutcome`, `order_not_payable`).
   */
  | { readonly action: "expire"; readonly capReached: boolean }
  /**
   * Keep the order: move `expires_at` (and, through `decideExtend`, its active reservations to
   * `reservationExpiresAt(expiresAt)`) to `expiresAt`, journal a `system` payment event and make job 11 due for
   * `attemptIdsToCheck`.
   */
  | {
      readonly action: "defer";
      readonly expiresAt: Date;
      readonly attemptIdsToCheck: readonly string[];
    };

/**
 * An order whose deadline has come (`orderExpiresAt <= now`) is not expired while one of its attempts is live
 * (`creating`, `awaiting_customer`, `processing`, `create_unknown`): a live attempt has had no final provider answer, and
 * Monobank sends no `expired` webhook (M8). The deadline then moves to `orderExpiresAt + 10 minutes` (or `now + 10
 * minutes` when the job runs more than one step late), never past the cap `placedAt + ttlMinutes + 30 minutes`; at the
 * cap the order expires anyway. The deadline never moves back. Invalid dates, a TTL out of its range and unknown
 * statuses are bugs (RangeError).
 */
export function decideExpiry(input: {
  readonly now: Date;
  readonly orderExpiresAt: Date;
  readonly placedAt: Date;
  readonly ttlMinutes: number;
  readonly attempts: readonly ExpiryAttempt[];
}): ExpiryDecision {
  assertDate(input.now, "now");
  assertDate(input.orderExpiresAt, "orderExpiresAt");
  const capMs =
    normalOrderDeadline(input.placedAt, input.ttlMinutes).getTime() +
    PAYMENT_EXPIRY_DEFERRAL.capMinutes * MINUTE_MS;
  const live = input.attempts.filter((attempt) => isLivePaymentStatus(attempt.status));
  const nowMs = input.now.getTime();
  const deadlineMs = input.orderExpiresAt.getTime();
  if (nowMs < deadlineMs) {
    return Object.freeze({ action: "not_due" as const });
  }
  if (live.length === 0) {
    return Object.freeze({ action: "expire" as const, capReached: false });
  }
  const stepMs = PAYMENT_EXPIRY_DEFERRAL.stepMinutes * MINUTE_MS;
  const stepped = deadlineMs + stepMs > nowMs ? deadlineMs + stepMs : nowMs + stepMs;
  const nextMs = Math.min(stepped, capMs);
  if (nextMs <= deadlineMs || nowMs >= capMs) {
    return Object.freeze({ action: "expire" as const, capReached: true });
  }
  return Object.freeze({
    action: "defer" as const,
    expiresAt: new Date(nextMs),
    attemptIdsToCheck: Object.freeze(live.map((attempt) => attempt.id)),
  });
}
