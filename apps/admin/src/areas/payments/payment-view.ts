import type {
  AdminPayment,
  AdminPaymentHistoryEntry,
  PaymentAttemptStatus,
  PaymentAttentionCode,
  PaymentEventSource,
  PaymentOrderOutcome,
  PaymentRefundReason,
  PaymentRefundStatus,
} from "@fluxkit/api-client";
import type { StatusTone } from "@fluxkit/ui";
import { actorLabel } from "../../lib/actor-label";
import { canRun } from "../../permissions";
import type { HistoryActor } from "../orders/order-view";

/**
 * How the order detail and the attention list present and gate the payments of an order (payments plan step 10; ADR 0032
 * decisions 11 and 18, `docs/api/payments.md`, "Admin routes"). Pure. The offered actions are HINTS: the API decides under
 * its row locks and its refusal is shown. Each action needs the permission of its own operation (read from
 * `ADMIN_OPERATIONS`, never from a role name), so a session without the refund permission is offered no refund and no clear.
 */

export const PAYMENT_STATUS_LIST = [
  "creating",
  "awaiting_customer",
  "processing",
  "succeeded",
  "failed",
  "expired",
  "invalidated",
  "create_unknown",
] as const satisfies readonly PaymentAttemptStatus[];

export const PAYMENT_STATUS_TONES: Record<PaymentAttemptStatus, StatusTone> = {
  creating: "neutral",
  awaiting_customer: "neutral",
  processing: "warning",
  succeeded: "success",
  failed: "danger",
  expired: "neutral",
  invalidated: "neutral",
  create_unknown: "warning",
};

export function paymentStatusLabelKey(status: PaymentAttemptStatus): string {
  return `payment.status.${status}`;
}

export const REFUND_STATUS_LIST = [
  "requested",
  "processing",
  "succeeded",
  "failed",
  "unknown",
] as const satisfies readonly PaymentRefundStatus[];

export const REFUND_STATUS_TONES: Record<PaymentRefundStatus, StatusTone> = {
  requested: "warning",
  processing: "warning",
  succeeded: "success",
  failed: "danger",
  unknown: "warning",
};

export function refundStatusLabelKey(status: PaymentRefundStatus): string {
  return `payment.refundStatus.${status}`;
}

export const REFUND_REASON_LIST = [
  "admin",
  "late_payment",
  "duplicate_payment",
  "amount_mismatch",
] as const satisfies readonly PaymentRefundReason[];

/** Every attention code of the API (`PaymentAttentionCode`); each has a title and a "what to do" text in the messages. */
export const PAYMENT_ATTENTION_CODES = [
  "late_payment",
  "duplicate_payment",
  "amount_mismatch",
  "fact_not_bound",
  "unknown_provider_status",
  "unexpected_provider_status",
  "external_reversal",
  "refund_failed",
  "refund_mismatch",
  "reconcile_gave_up",
] as const satisfies readonly PaymentAttentionCode[];

export const PAYMENT_EVENT_SOURCES = [
  "webhook",
  "poll",
  "create",
  "admin",
  "system",
] as const satisfies readonly PaymentEventSource[];

export const PAYMENT_ORDER_OUTCOMES = [
  "applied",
  "already_paid",
  "order_not_payable",
  "amount_mismatch",
  "reference_conflict",
] as const satisfies readonly PaymentOrderOutcome[];

export const PAYMENT_CREATORS = ["customer", "guest", "admin"] as const;

/** A code this build does not know (a newer API) is shown as the generic text, never as the raw word. */
export function attentionCodeKey(code: PaymentAttentionCode | null): string {
  return code !== null && (PAYMENT_ATTENTION_CODES as readonly string[]).includes(code)
    ? code
    : "unknown";
}

export const PAYMENT_ACTIONS = ["refund", "resync", "clearAttention"] as const;
export type PaymentAction = (typeof PAYMENT_ACTIONS)[number];

/** The operation behind each action: its permission decides whether the session is offered it. */
export const PAYMENT_ACTION_OPERATIONS = {
  refund: "refundPayment",
  resync: "resyncPayment",
  clearAttention: "clearPaymentAttention",
} as const;

/**
 * The actions to offer for one payment, in display order:
 * - refund: only a `succeeded` attempt with something left to refund, and only with the refund permission;
 * - resync ("check status"): an attempt the provider knows (it has a provider id), with `orders.write`;
 * - clear attention: only while the item is open, with the refund permission.
 */
export function offeredPaymentActions(
  payment: Pick<
    AdminPayment,
    "status" | "refundableAmount" | "providerPaymentId" | "needsAttention"
  >,
  permissions: readonly string[] | null,
): PaymentAction[] {
  const wanted: Record<PaymentAction, boolean> = {
    refund: payment.status === "succeeded" && payment.refundableAmount.amount > 0,
    resync: payment.providerPaymentId !== null,
    clearAttention: payment.needsAttention,
  };
  return PAYMENT_ACTIONS.filter(
    (action) => wanted[action] && canRun(permissions, PAYMENT_ACTION_OPERATIONS[action]),
  );
}

/** Whether the panel mentions refunds at all: the order has a succeeded attempt. */
export function hasSucceededPayment(payments: readonly Pick<AdminPayment, "status">[]): boolean {
  return payments.some((payment) => payment.status === "succeeded");
}

/** Who did a journal entry: the admin of an admin action, the removed admin when the id is gone, else the payment system. */
export function paymentEntryActor(
  entry: Pick<AdminPaymentHistoryEntry, "source" | "actorAdminId">,
  meId: string,
  emails: ReadonlyMap<string, string> | null,
): HistoryActor {
  if (entry.source !== "admin") return { kind: "system" };
  return entry.actorAdminId === null
    ? { kind: "removedAdmin" }
    : actorLabel(entry.actorAdminId, meId, emails);
}

/** Admin who requested a refund; an automatic refund has none (`null`, the system). */
export function refundActor(
  actorAdminId: string | null,
  meId: string,
  emails: ReadonlyMap<string, string> | null,
): HistoryActor {
  return actorLabel(actorAdminId, meId, emails);
}
