/*
 * Problem, rule, attention and stored value codes of payments (ADR 0032 decisions 5, 7, 11 and 18). Constants only; the
 * API maps them to answers and CHECK lists (plan steps 3, 5, 6 and 8). Do not add a code here without a recorded
 * decision in ADR 0032 or a document that refines it (the attention codes were fixed in plan step 2).
 */

/** New problem `code` values (`503`). */
export const PAYMENT_PROBLEM_CODES = Object.freeze(["payment_provider_unavailable"] as const);

export type PaymentProblemCode = (typeof PAYMENT_PROBLEM_CODES)[number];

/** `rule` of a `409 rule_violation` (decision 18). The existing `order_not_payable` and `idempotency_key_reused` stay. */
export const PAYMENT_RULE_VIOLATIONS = Object.freeze([
  "payment_in_progress",
  "payment_window_too_short",
  "payment_not_available",
  "refund_not_allowed",
  "refund_exceeds_remaining",
  "partial_refund_not_supported",
] as const);

export type PaymentRuleViolation = (typeof PAYMENT_RULE_VIOLATIONS)[number];

/** Why a refund exists (`payment_refund.reason`). */
export const REFUND_REASONS = Object.freeze([
  "admin",
  "late_payment",
  "duplicate_payment",
  "amount_mismatch",
] as const);

export type RefundReason = (typeof REFUND_REASONS)[number];

/** Where a journal row comes from (`payment_event.source`). */
export const PAYMENT_EVENT_SOURCES = Object.freeze([
  "webhook",
  "poll",
  "create",
  "admin",
  "system",
] as const);

export type PaymentEventSource = (typeof PAYMENT_EVENT_SOURCES)[number];

/** Who created an attempt (`payment.created_by`; admin-created payment links are later). */
export const PAYMENT_CREATED_BY = Object.freeze(["customer", "guest", "admin"] as const);

export type PaymentCreatedBy = (typeof PAYMENT_CREATED_BY)[number];

/**
 * `payment.attention_code`: every case an admin must see (decision 5, `needs_attention`). Fixed in plan step 2:
 * - `late_payment`, `duplicate_payment`: a success the order could not take (refunded automatically).
 * - `amount_mismatch`: markPaid refused the amount, or a fact's amount, currency, final amount or refunds do not bind.
 * - `fact_not_bound`: a fact names another provider id or reference than the attempt.
 * - `unknown_provider_status`: the provider sent a status the plugin does not know (the attempt keeps its status).
 * - `unexpected_provider_status`: a known status no v1 flow produces (`authorized`), or a newer fact contradicting success.
 * - `external_reversal`: `reversed` that our own refunds do not explain (a refund made outside the shop).
 * - `refund_failed`, `refund_mismatch`: a refund the provider refused, or listed with another amount or twice.
 * - `reconcile_gave_up`: the reconcile schedule ended without a final answer (also a refund that stayed `unknown`).
 */
export const PAYMENT_ATTENTION_CODES = Object.freeze([
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
] as const);

export type PaymentAttentionCode = (typeof PAYMENT_ATTENTION_CODES)[number];
