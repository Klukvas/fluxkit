import type { MarkPaidOutcome } from "../orders/events.js";
import type { PaymentAttentionCode, RefundReason } from "./reasons.js";

/*
 * What a success does to the order (ADR 0032 decision 7, the outcome table, core `decideOrderOutcome`). The API applies
 * a bound `succeeded` fact in one transaction: the attempt moves to `succeeded`, then `OrdersService.markPaidIn` answers,
 * and this table says what is stored in `payment.order_outcome`, whether the attempt needs attention and whether a full
 * automatic refund is queued (run after commit, never inside the webhook transaction, decision 11). The order-side
 * input is plain data: markPaid's answer. `order.paid` is emitted by `markPaidIn` itself, only for `applied`.
 */

/** `payment.order_outcome` (decision 5); `NULL` until `markPaidIn` answered. */
export const PAYMENT_ORDER_OUTCOMES = Object.freeze([
  "applied",
  "already_paid",
  "order_not_payable",
  "amount_mismatch",
  "reference_conflict",
] as const);

export type PaymentOrderOutcome = (typeof PAYMENT_ORDER_OUTCOMES)[number];

export interface OrderOutcomeDecision {
  readonly orderOutcome: PaymentOrderOutcome;
  readonly attentionCode: PaymentAttentionCode | null;
  /** The reason of the full automatic refund to queue, `null` for none. */
  readonly automaticRefund: Extract<RefundReason, "late_payment" | "duplicate_payment"> | null;
}

function decision(
  orderOutcome: PaymentOrderOutcome,
  attentionCode: PaymentAttentionCode | null,
  automaticRefund: OrderOutcomeDecision["automaticRefund"],
): OrderOutcomeDecision {
  return Object.freeze({ orderOutcome, attentionCode, automaticRefund });
}

/**
 * | markPaidIn answer | result |
 * |---|---|
 * | ok | `applied` |
 * | ok alreadyPaid (same reference) | `already_paid`, nothing else |
 * | `order_not_payable` (expired, cancelled, reservation gone) | attention `late_payment`, full refund `late_payment` |
 * | `payment_reference_conflict` (paid by another attempt or by hand) | attention, full refund `duplicate_payment` |
 * | `amount_mismatch` | attention, NO automatic refund (an admin decides) |
 *
 * `order_not_found` and `invalid_transition` are outside the table: the attempt's order exists (a RESTRICT foreign key)
 * and `markPaidIn` maps every refused transition of a payable order to `order_not_payable`, so either answer is a bug and
 * throws a RangeError (the transaction rolls back; the fact stays unapplied, job 11 reads it again and finally raises
 * `reconcile_gave_up`).
 */
export function decideOrderOutcome(answer: MarkPaidOutcome): OrderOutcomeDecision {
  if (typeof answer !== "object" || answer === null) {
    throw new RangeError("decideOrderOutcome needs markPaid's answer");
  }
  if (answer.ok) {
    return answer.alreadyPaid
      ? decision("already_paid", null, null)
      : decision("applied", null, null);
  }
  switch (answer.reason) {
    case "order_not_payable":
      return decision("order_not_payable", "late_payment", "late_payment");
    case "payment_reference_conflict":
      return decision("reference_conflict", "duplicate_payment", "duplicate_payment");
    case "amount_mismatch":
      return decision("amount_mismatch", "amount_mismatch", null);
    default:
      throw new RangeError(`markPaid answered outside the outcome table: ${String(answer.reason)}`);
  }
}
