import { assertDate } from "./guards.js";
import { PAYMENT_CHECK_DELAYS_MINUTES, PAYMENT_CHECK_HOURLY_CHECKS } from "./limits.js";

/*
 * The reconcile schedule of job 11 (ADR 0032 decision 13): status reads of attempts that are `processing`,
 * `awaiting_customer` past their `expires_at`, `create_unknown`, or have unfinished refund work. Pure; `now` is a
 * parameter.
 */

const MINUTE_MS = 60_000;
const HOUR_MINUTES = 60;

export type PaymentCheckDecision =
  | { readonly action: "check"; readonly at: Date }
  | { readonly action: "give_up"; readonly attentionCode: "reconcile_gave_up" };

/**
 * `checks` is the number of status reads made so far (`payment.check_attempts`, after the one just made). None yet: due
 * now. After read 1 to 5: 1, 2, 5, 10, 30 minutes; then hourly 48 times (48 hours); then `give_up` with attention
 * `reconcile_gave_up` (an attempt or a refund that stayed `unknown` is never failed automatically). A count that is not a
 * whole number of at least 0, or an invalid date, is a bug (RangeError).
 */
export function nextPaymentCheck(input: {
  readonly checks: number;
  readonly now: Date;
}): PaymentCheckDecision {
  const { checks } = input;
  if (!Number.isSafeInteger(checks) || checks < 0) {
    throw new RangeError("checks must be a whole number of at least 0");
  }
  assertDate(input.now, "now");
  let minutes: number;
  if (checks === 0) {
    minutes = 0;
  } else if (checks <= PAYMENT_CHECK_DELAYS_MINUTES.length) {
    minutes = PAYMENT_CHECK_DELAYS_MINUTES[checks - 1] as number;
  } else if (checks <= PAYMENT_CHECK_DELAYS_MINUTES.length + PAYMENT_CHECK_HOURLY_CHECKS) {
    minutes = HOUR_MINUTES;
  } else {
    return Object.freeze({
      action: "give_up" as const,
      attentionCode: "reconcile_gave_up" as const,
    });
  }
  return Object.freeze({
    action: "check" as const,
    at: new Date(input.now.getTime() + minutes * MINUTE_MS),
  });
}
