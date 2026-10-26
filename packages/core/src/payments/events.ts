import { ORDER_NUMBER_PATTERN } from "../orders/number.js";
import { isUuid } from "./guards.js";
import {
  PAYMENT_STATUSES,
  REFUND_STATUSES,
  type PaymentStatus,
  type RefundStatus,
} from "./status.js";

/*
 * Payment domain events (ADR 0032 decision 18, ADR 0018). Names and payload builders only; reserved, not written yet: the
 * API writes them into the `domain_event` outbox in the transaction of the change (plan step 5). Payloads carry ids, the
 * order number and the status only: never an amount, a card or a provider id. `order.paid` stays the only paid event.
 */

export const PAYMENT_EVENT_TYPES = Object.freeze([
  "payment.status_changed",
  "payment.refund_status_changed",
] as const);

export type PaymentEventType = (typeof PAYMENT_EVENT_TYPES)[number];

export interface PaymentEventPayload {
  readonly paymentId: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: PaymentStatus;
}

export interface RefundEventPayload {
  readonly refundId: string;
  readonly paymentId: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: RefundStatus;
}

function checkCommon(input: { paymentId: unknown; orderId: unknown; orderNumber: unknown }): void {
  if (!isUuid(input.paymentId)) {
    throw new RangeError("A payment event needs the payment id (uuid)");
  }
  if (!isUuid(input.orderId)) {
    throw new RangeError("A payment event needs the order id (uuid)");
  }
  if (typeof input.orderNumber !== "string" || !ORDER_NUMBER_PATTERN.test(input.orderNumber)) {
    throw new RangeError("A payment event needs the order number");
  }
}

/** The payload of `payment.status_changed`, built field by field; a malformed value is a bug (RangeError). */
export function buildPaymentEventPayload(input: PaymentEventPayload): PaymentEventPayload {
  checkCommon(input);
  if (!PAYMENT_STATUSES.includes(input.status)) {
    throw new RangeError(`Unknown payment status: ${String(input.status)}`);
  }
  return Object.freeze({
    paymentId: input.paymentId,
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    status: input.status,
  });
}

/** The payload of `payment.refund_status_changed`, built field by field; a malformed value is a bug (RangeError). */
export function buildRefundEventPayload(input: RefundEventPayload): RefundEventPayload {
  checkCommon(input);
  if (!isUuid(input.refundId)) {
    throw new RangeError("A refund event needs the refund id (uuid)");
  }
  if (!REFUND_STATUSES.includes(input.status)) {
    throw new RangeError(`Unknown refund status: ${String(input.status)}`);
  }
  return Object.freeze({
    refundId: input.refundId,
    paymentId: input.paymentId,
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    status: input.status,
  });
}
