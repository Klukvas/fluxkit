import { CODE_PATTERN } from "../catalog/limits.js";

/*
 * Payment codes, patterns, limits and times (ADR 0032 decisions 3, 5, 8, 9, 12, 13 and 14; plan step 2). Constants only;
 * the API and the provider packages enforce them. Times are durations; core never reads a clock or the configuration.
 */

/** The shape of a payment provider code (`"monobank"`, `"fake"`), the same as every other code. */
export const PAYMENT_PROVIDER_CODE_PATTERN = CODE_PATTERN;

/**
 * A provider or outcome code (`PaymentProviderResult.providerCodes`, `payment.failure_code`, `payment_refund.failure_code`):
 * short, no spaces, so a provider's message text (Monobank `errText`, M16) never fits. ADR 0032 decision 5.
 */
export const PAYMENT_CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

/**
 * The provider's id of a payment (`payment.provider_payment_id`, Monobank `invoiceId`). No colon, so the markPaid reference
 * `<provider>:<id>` (`buildProviderReference`) splits one way only. The exact Monobank alphabet is checked at S1.
 */
export const PROVIDER_PAYMENT_ID_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

/** The provider's raw status (`payment.provider_status`, Monobank `success`): a short word, no colon (dedupe keys). */
export const PAYMENT_PROVIDER_STATUS_PATTERN = /^[A-Za-z0-9_.-]{1,32}$/;

/** Card data shown to admins (question 12): the card system and the last four digits only, never a BIN or a mask. */
export const PAYMENT_CARD_SYSTEM_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,31}$/;

export const PAYMENT_CARD_LAST4_PATTERN = /^[0-9]{4}$/;

export const PAYMENT_LIMITS = Object.freeze({
  /** Largest webhook body the route reads (decision 12). */
  webhookBodyMaxBytes: 64 * 1024,
  /** Largest provider answer a plugin reads (decision 14). */
  providerAnswerMaxBytes: 64 * 1024,
  /** The payment description shown by the provider (Monobank `destination`, decision 6), in code points. */
  descriptionMaxLength: 280,
  /** Most codes one provider failure carries. */
  maxProviderCodes: 10,
  /** Most refunds one provider fact lists (Monobank `cancelList`). */
  maxFactRefunds: 100,
  /** The markPaid reference (`sales_order.payment_reference`, ADR 0017). */
  providerReferenceMaxLength: 255,
  /** The `reference` a fact carries (ours is the attempt id, a uuid). */
  factReferenceMaxLength: 255,
  /** An admin's refund note, in code points (decision 5). */
  refundNoteMinLength: 1,
  refundNoteMaxLength: 500,
  /** The store status route reads the provider only when its last read is older than this (decision 6). */
  statusReadMinAgeSeconds: 10,
});

/** Time the API gives one provider call before it aborts it (decision 3): the API decides, not the plugin. */
export const PAYMENT_PROVIDER_TIMEOUT_MS = 10_000;

/**
 * Invoice validity (decision 9, open question 3): the invoice ends `marginMinutes` before the order deadline and must
 * leave the shopper at least `minimumMinutes` to pay (measured on the invoice, see `invoiceValidity`).
 */
export const PAYMENT_INVOICE_WINDOW = Object.freeze({ marginMinutes: 3, minimumMinutes: 5 });

/**
 * Expiry while a payment is in flight (decision 8, owner answer 2): the order deadline moves in steps of `stepMinutes`,
 * at most `capMinutes` past `placed_at + ORDER_PAYMENT_TTL_MINUTES`.
 */
export const PAYMENT_EXPIRY_DEFERRAL = Object.freeze({ stepMinutes: 10, capMinutes: 30 });

/** Waits of the reconcile job after check 1 to 5 of an attempt (decision 13); then hourly. */
export const PAYMENT_CHECK_DELAYS_MINUTES: readonly number[] = Object.freeze([1, 2, 5, 10, 30]);

/** Hourly checks after the schedule above (48 hours) before an attempt becomes `reconcile_gave_up`. */
export const PAYMENT_CHECK_HOURLY_CHECKS = 48;
