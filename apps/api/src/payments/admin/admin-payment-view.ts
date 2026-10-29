import {
  PAYMENT_ATTENTION_CODES,
  PAYMENT_CREATED_BY,
  PAYMENT_EVENT_SOURCES,
  PAYMENT_ORDER_OUTCOMES,
  REFUND_REASONS,
  remainingRefundable,
  type AdminOrderPaymentHistoryEntry,
  type AdminOrderPaymentRefundView,
  type AdminOrderPaymentView,
  type Money,
  type PaymentAttentionCode,
  type PaymentCreatedBy,
  type PaymentEventSource,
  type PaymentOrderOutcome,
  type RefundReason,
} from "@fluxkit/core";
import { paymentStatusOf, refundStatusOf } from "../attempts/payment-changes.js";
import type {
  PaymentEventRow,
  PaymentRow,
  RefundRow,
} from "../attempts/payments.repository.js";

/*
 * The ONE admin view of a payment attempt (ADR 0032 decision 18): the `payments` of `GET /admin/orders/{id}` (and of
 * `OrderReadPort`), the answers of the admin payment routes and the attention list are all this builder. Built field by
 * field from the rows, never by spreading one: no page URL (`redirect_url`), no idempotency key, no dedupe key, no
 * reconcile counter; card data is the system and the last four digits only (decision 1, question 12).
 */

/** Stored values outside these lists are damaged data: loud, never passed on. */
function member<T extends string>(list: readonly T[], value: string, name: string): T {
  if (!list.includes(value as T)) {
    throw new RangeError(`A payment row has an unknown ${name}: ${value}`);
  }
  return value as T;
}

/** Stored money as core money (the CHECKs keep the currency a code core knows). Not imported from the services: the order view imports this file. */
function moneyOf(amount: number, currency: string): Money {
  return { amount, currency: currency as Money["currency"] };
}

function instant(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export function toAdminRefund(row: RefundRow): AdminOrderPaymentRefundView {
  return {
    id: row.id,
    amount: { amount: row.amount, currency: row.currency },
    status: refundStatusOf(row.status),
    reason: member<RefundReason>(REFUND_REASONS, row.reason, "refund reason"),
    note: row.note,
    actorAdminId: row.actorAdminId,
    failureCode: row.failureCode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Journal rows an admin reads: status changes, provider facts and admin actions. The refund send claims and their retry
 * notes (`system` rows without a status or a fact) are bookkeeping of the exactly-once send and are left out.
 */
function isShownEntry(row: PaymentEventRow): boolean {
  return row.toStatus !== null || row.providerStatus !== null || row.source === "admin";
}

function toHistoryEntry(row: PaymentEventRow): AdminOrderPaymentHistoryEntry {
  return {
    source: member<PaymentEventSource>(PAYMENT_EVENT_SOURCES, row.source, "journal source"),
    fromStatus: row.fromStatus === null ? null : paymentStatusOf(row.fromStatus),
    toStatus: row.toStatus === null ? null : paymentStatusOf(row.toStatus),
    providerStatus: row.providerStatus,
    providerModifiedAt: instant(row.providerModifiedAt),
    applied: row.applied,
    failureCode: row.failureCode,
    actorAdminId: row.actorAdminId,
    at: row.createdAt.toISOString(),
  };
}

/** One attempt with its refunds and journal (the caller passes the rows of THIS attempt, oldest first). */
export function toAdminPayment(
  row: PaymentRow,
  refunds: readonly RefundRow[],
  events: readonly PaymentEventRow[],
): AdminOrderPaymentView {
  const status = paymentStatusOf(row.status);
  const amount = moneyOf(row.amount, row.currency);
  const refundable =
    status === "succeeded"
      ? remainingRefundable(
          amount,
          refunds.map((refund) => ({
            amount: moneyOf(refund.amount, refund.currency),
            status: refundStatusOf(refund.status),
          })),
        ).amount
      : 0;
  return {
    id: row.id,
    providerCode: row.providerCode,
    providerPaymentId: row.providerPaymentId,
    status,
    amount: { amount: row.amount, currency: row.currency },
    finalAmount:
      row.finalAmount === null ? null : { amount: row.finalAmount, currency: row.currency },
    refundedAmount: { amount: row.refundedAmount, currency: row.currency },
    refundableAmount: { amount: refundable, currency: row.currency },
    providerStatus: row.providerStatus,
    providerModifiedAt: instant(row.providerModifiedAt),
    failureCode: row.failureCode,
    orderOutcome:
      row.orderOutcome === null
        ? null
        : member<PaymentOrderOutcome>(PAYMENT_ORDER_OUTCOMES, row.orderOutcome, "order outcome"),
    needsAttention: row.needsAttention,
    attentionCode:
      row.attentionCode === null
        ? null
        : member<PaymentAttentionCode>(PAYMENT_ATTENTION_CODES, row.attentionCode, "attention code"),
    card:
      row.cardSystem === null || row.cardLast4 === null
        ? null
        : { system: row.cardSystem, last4: row.cardLast4 },
    createdBy: member<PaymentCreatedBy>(PAYMENT_CREATED_BY, row.createdBy, "creator"),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    nextCheckAt: instant(row.nextCheckAt),
    refunds: refunds.map(toAdminRefund),
    history: events.filter(isShownEntry).map(toHistoryEntry),
  };
}

/** Every attempt of a set, each with its own refunds and journal (rows of several attempts, as listed by the repository). */
export function toAdminPayments(
  rows: readonly PaymentRow[],
  refunds: readonly RefundRow[],
  events: readonly PaymentEventRow[],
): AdminOrderPaymentView[] {
  return rows.map((row) =>
    toAdminPayment(
      row,
      refunds.filter((refund) => refund.paymentId === row.id),
      events.filter((event) => event.paymentId === row.id),
    ),
  );
}
