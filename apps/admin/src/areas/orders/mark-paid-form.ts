import type { AdminOrder, MarkAdminOrderPaidBody } from "@fluxkit/api-client";
import { checkActionText, type TextIssue } from "./text-rules";

/**
 * The mark-paid dialog's model (owner answer 8). The amount is NOT a value of the form: the body takes the order's own
 * total (integer minor units and currency, as the API answered it), shown read-only, so a typo cannot send another
 * amount (the API would refuse it with `amount_mismatch` anyway). The admin types the payment reference and ticks "I
 * received this amount". Mark-paid is idempotent by reference (`docs/api/orders.md`: the same reference on an order that
 * is already paid or fulfilled answers `200` with the order unchanged; another reference is `payment_reference_conflict`),
 * so after a lost answer the screen reloads the order, says whether that reference was recorded, and keeps the SAME
 * reference for a retry by the admin. The screen itself never retries.
 */

/** `reference` of `POST /admin/orders/{id}/mark-paid`: trimmed, 1 to 255 characters. */
export const PAYMENT_REFERENCE_MAX_LENGTH = 255;

export interface MarkPaidValues {
  reference: string;
  received: boolean;
}

export const EMPTY_MARK_PAID: MarkPaidValues = { reference: "", received: false };

export interface MarkPaidIssues {
  reference?: TextIssue;
  received?: "confirmation_required";
}

export type MarkPaidPlan =
  { ok: true; body: MarkAdminOrderPaidBody } | { ok: false; issues: MarkPaidIssues };

export function planMarkPaid(
  values: MarkPaidValues,
  order: Pick<AdminOrder, "total" | "currency">,
): MarkPaidPlan {
  const issues: MarkPaidIssues = {};
  const reference = checkActionText(values.reference, PAYMENT_REFERENCE_MAX_LENGTH);
  if (!reference.ok) issues.reference = reference.issue;
  if (!values.received) issues.received = "confirmation_required";
  if (!reference.ok || issues.received !== undefined) return { ok: false, issues };
  return {
    ok: true,
    body: {
      reference: reference.value,
      amount: { amount: order.total.amount, currency: order.total.currency },
    },
  };
}

export function isMarkPaidDirty(values: MarkPaidValues): boolean {
  return values.reference !== "" || values.received;
}

/** What the order read again after a lost answer says about the payment that was sent. */
export type MarkPaidCheck =
  "recorded" | "not_recorded" | "paid_with_other_reference" | "not_payable";

export function markPaidCheckAfterUnknown(
  order: Pick<AdminOrder, "status" | "paymentReference">,
  sentReference: string,
): MarkPaidCheck {
  switch (order.status) {
    case "awaiting_payment":
      return "not_recorded";
    case "paid":
    case "fulfilled":
      return order.paymentReference === sentReference ? "recorded" : "paid_with_other_reference";
    case "cancelled":
    case "expired":
      return "not_payable";
  }
}

/** The dialog after a lost answer: the same reference (a retry is safe by reference), the confirmation asked again. */
export function valuesForRetry(sent: MarkAdminOrderPaidBody): MarkPaidValues {
  return { reference: sent.reference, received: false };
}
