import type { CancelAdminOrderBody, OrderStatus } from "@fluxkit/api-client";
import { checkActionText, type TextIssue } from "./action-text";

/**
 * The cancel dialog's model: a required reason (the API keeps it on the order and in the status journal) and what the
 * cancel does to the stock, for the warning (`docs/api/orders.md`, ADR 0017 and 0022): an unpaid order's reservations
 * are released; a paid order's sold units stay sold, nothing is restocked and nothing is refunded (the stock `return`
 * and the refund are recorded by hand), only the still-reserved remainder of a backordered line is released.
 */

/** `reason` of `POST /admin/orders/{id}/cancel`: trimmed, 1 to 500 characters. */
export const CANCELLATION_REASON_MAX_LENGTH = 500;

export interface CancelValues {
  reason: string;
}

export const EMPTY_CANCEL: CancelValues = { reason: "" };

export type CancelPlan = { ok: true; body: CancelAdminOrderBody } | { ok: false; issue: TextIssue };

export function planCancel(values: CancelValues): CancelPlan {
  const reason = checkActionText(values.reason, CANCELLATION_REASON_MAX_LENGTH);
  return reason.ok ? { ok: true, body: { reason: reason.value } } : reason;
}

export function isCancelDirty(values: CancelValues): boolean {
  return values.reason !== "";
}

/** core's stock effect of an admin cancel from `status`, or `null` when no cancel is possible. */
export type CancelConsequence = "release" | "release_unsold";

export function cancelConsequence(status: OrderStatus): CancelConsequence | null {
  switch (status) {
    case "awaiting_payment":
      return "release";
    case "paid":
      return "release_unsold";
    default:
      return null;
  }
}
