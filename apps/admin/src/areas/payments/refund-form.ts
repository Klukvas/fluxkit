import type { AdminPayment, RefundAdminPaymentBody } from "@fluxkit/api-client";
import { amountToInputText, parseMoneyInput, type MoneyInputFailure } from "../../lib/money-input";
import { checkActionText, type TextIssue } from "../orders/action-text";

/**
 * The refund dialog's model (ADR 0032 decision 11; `docs/api/payments.md`, "Admin routes"). The amount is typed as decimal
 * TEXT and turned into integer minor units with the currency's exponent, never through a floating point number
 * (`lib/money-input.ts`). It starts at the REMAINING refundable amount the API sent (`refundableAmount`: the amount less every
 * refund that is not `failed`), so the default is "refund the rest". The limit checked here is a hint: the API decides under
 * the payment row lock, and its refusal is shown.
 *
 * The `Idempotency-Key` is one UUID per refund the admin confirms. A repeat of the same request (a lost answer, a refusal,
 * a second submit of the same form) reuses it, so the API answers the same refund and sends nothing twice; a request whose
 * amount or note changed gets a new key (the API refuses the same key with another body). The screen itself never repeats a
 * send: only the admin submits again.
 */

/** `note` of the refund route: trimmed, 1 to 500 characters (`PAYMENT_LIMITS`, copied: the browser bundle may not import core). */
export const REFUND_NOTE_MAX_LENGTH = 500;

export interface RefundValues {
  /** Decimal text in the payment currency (`189.00`). */
  amount: string;
  note: string;
}

export type RefundAmountIssue = MoneyInputFailure | "not_positive" | "exceeds_remaining";

export interface RefundIssues {
  amount?: RefundAmountIssue;
  note?: TextIssue;
}

export type RefundPlan =
  { ok: true; body: RefundAdminPaymentBody } | { ok: false; issues: RefundIssues };

export function refundDefaults(
  payment: Pick<AdminPayment, "refundableAmount">,
  exponent: number,
): RefundValues {
  return { amount: amountToInputText(payment.refundableAmount.amount, exponent), note: "" };
}

export function planRefund(
  values: RefundValues,
  payment: Pick<AdminPayment, "refundableAmount">,
  exponent: number,
): RefundPlan {
  const issues: RefundIssues = {};
  const amount = parseMoneyInput(values.amount, exponent);
  let minorUnits = 0;
  if (!amount.ok) issues.amount = amount.reason;
  else if (amount.amount < 1) issues.amount = "not_positive";
  else if (amount.amount > payment.refundableAmount.amount) issues.amount = "exceeds_remaining";
  else minorUnits = amount.amount;
  const note = checkActionText(values.note, REFUND_NOTE_MAX_LENGTH);
  if (!note.ok) issues.note = note.issue;
  if (issues.amount !== undefined || !note.ok) return { ok: false, issues };
  return {
    ok: true,
    body: {
      amount: { amount: minorUnits, currency: payment.refundableAmount.currency },
      note: note.value,
    },
  };
}

export function isRefundDirty(values: RefundValues, defaults: RefundValues): boolean {
  return values.amount !== defaults.amount || values.note !== defaults.note;
}

/** The request a key was used for: a repeat of exactly this one may reuse the key. */
export interface SentRefund {
  amount: number;
  currency: string;
  note: string;
}

export interface RefundDraft {
  key: string;
  /** What was last sent with `key`; `null` before the first send. */
  sent: SentRefund | null;
}

export function newRefundDraft(makeKey: () => string): RefundDraft {
  return { key: makeKey(), sent: null };
}

/**
 * The draft to send `body` with: the same key when this is a repeat of the last request (or the first send), a new key when
 * the body changed since the key was used.
 */
export function resolveRefundKey(
  draft: RefundDraft,
  body: RefundAdminPaymentBody,
  makeKey: () => string,
): RefundDraft {
  const sent: SentRefund = {
    amount: body.amount.amount,
    currency: body.amount.currency,
    note: body.note,
  };
  const same =
    draft.sent === null ||
    (draft.sent.amount === sent.amount &&
      draft.sent.currency === sent.currency &&
      draft.sent.note === sent.note);
  return { key: same ? draft.key : makeKey(), sent };
}

/** A refund whose answer never came: kept so the admin can reopen the dialog and send the SAME request (same key). */
export interface LostRefundAttempt {
  paymentId: string;
  values: RefundValues;
  draft: RefundDraft;
}

export interface OpenedRefundDialog {
  values: RefundValues;
  draft: RefundDraft;
  /** The dialog continues a request that got no answer. */
  retrying: boolean;
}

/** The state of a freshly opened dialog: the remaining amount and a new key, or the lost attempt of this payment. */
export function openRefundDialog(
  lost: LostRefundAttempt | null,
  payment: Pick<AdminPayment, "id" | "refundableAmount">,
  exponent: number,
  makeKey: () => string,
): OpenedRefundDialog {
  if (lost !== null && lost.paymentId === payment.id) {
    return { values: lost.values, draft: lost.draft, retrying: true };
  }
  return {
    values: refundDefaults(payment, exponent),
    draft: newRefundDraft(makeKey),
    retrying: false,
  };
}
