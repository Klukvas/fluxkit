import type { PaymentOrderOutcome } from "./outcome.js";
import { PAYMENT_STATUSES, type PaymentStatus } from "./status.js";

/*
 * What a shopper sees of a payment attempt (ADR 0032 decisions 6 and 14, plan step 8): a small, provider-neutral set of
 * statuses for the store status routes and the store order view. Never a provider status, a provider code or a bank text
 * (Monobank `errText` is "informative only", M16): the failure categories say what the shopper can do about it.
 */

export const SHOPPER_PAYMENT_STATUSES = Object.freeze([
  /** The provider's page is open for the shopper (`awaiting_customer`). */
  "waiting",
  /** Our create call or the provider is still working, or the create answer was lost; the order updates by itself. */
  "processing",
  /** The order took this payment. */
  "paid",
  "failed",
  /** The invoice ended or was replaced by a newer attempt. */
  "expired",
] as const);

export type ShopperPaymentStatus = (typeof SHOPPER_PAYMENT_STATUSES)[number];

/**
 * Why an attempt did not pay the order, for a `failed` or `expired` attempt only:
 * - `declined`: the provider reported a failed payment on an invoice (the bank declined it, or the shopper cancelled;
 *   a provider's own failure codes are not mapped in v1, so the two are not told apart);
 * - `expired`: the invoice ended or was replaced;
 * - `technical`: no invoice could be made, or the create answer was lost (the shopper may try again when allowed);
 * - `not_accepted`: the provider took the money, but the order could not take it (it expired, was cancelled or paid
 *   otherwise, or the amounts disagree): it is refunded automatically or the shop settles it.
 */
export const SHOPPER_PAYMENT_FAILURE_CATEGORIES = Object.freeze([
  "declined",
  "expired",
  "technical",
  "not_accepted",
] as const);

export type ShopperPaymentFailureCategory = (typeof SHOPPER_PAYMENT_FAILURE_CATEGORIES)[number];

export interface ShopperPaymentView {
  readonly status: ShopperPaymentStatus;
  readonly failureCategory: ShopperPaymentFailureCategory | null;
}

/** The failure code job 11 writes when it closes an attempt whose create answer was lost (decision 13). */
const CREATE_UNKNOWN_FAILURE = "create_unknown";

function view(
  status: ShopperPaymentStatus,
  failureCategory: ShopperPaymentFailureCategory | null = null,
): ShopperPaymentView {
  return Object.freeze({ status, failureCategory });
}

/**
 * Maps a stored attempt to the shopper's view. `hasInvoice`: the attempt has a provider payment id. A `succeeded`
 * attempt is `paid` only when `markPaidIn` applied it (or found the order already paid by it); its outcome is written in
 * the same transaction as the status, so `null` there is read as applied. An unknown status is corrupt data
 * (RangeError).
 */
export function shopperPaymentStatus(input: {
  readonly status: PaymentStatus;
  readonly hasInvoice: boolean;
  readonly failureCode: string | null;
  readonly orderOutcome: PaymentOrderOutcome | null;
}): ShopperPaymentView {
  if (!PAYMENT_STATUSES.includes(input.status)) {
    throw new RangeError(`Unknown payment status: ${String(input.status)}`);
  }
  switch (input.status) {
    case "awaiting_customer":
      return view("waiting");
    case "creating":
    case "processing":
    case "create_unknown":
      return view("processing");
    case "succeeded":
      return input.orderOutcome === null ||
        input.orderOutcome === "applied" ||
        input.orderOutcome === "already_paid"
        ? view("paid")
        : view("failed", "not_accepted");
    case "failed":
      return !input.hasInvoice || input.failureCode === CREATE_UNKNOWN_FAILURE
        ? view("failed", "technical")
        : view("failed", "declined");
    case "expired":
    case "invalidated":
      return view("expired", "expired");
  }
}
