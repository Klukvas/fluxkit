/*
 * Problem, reason and rule codes of shipping (ADR 0029 decisions 4 and 7). Constants only; the API maps them to answers
 * (plan steps 5, 6 and 8). Do not add a code here without a recorded decision in ADR 0029 or a document that refines it.
 */

/** New problem `code` values of the checkout (`400`, `400`, `409`, `503`). */
export const SHIPPING_PROBLEM_CODES = Object.freeze([
  "shipping_method_required",
  "shipping_not_applicable",
  "shipping_changed",
  "shipping_provider_unavailable",
] as const);

export type ShippingProblemCode = (typeof SHIPPING_PROBLEM_CODES)[number];

/** `errors[].code` of a `validation_failed` answer at `shipping.pickupPointRef`. */
export const SHIPPING_VALIDATION_REASONS = Object.freeze(["unknown_pickup_point"] as const);

export type ShippingValidationReason = (typeof SHIPPING_VALIDATION_REASONS)[number];

/** `rule` of a `409 rule_violation`: a method used by an order can be deactivated, not deleted. */
export const SHIPPING_RULE_VIOLATIONS = Object.freeze(["method_in_use"] as const);

export type ShippingRuleViolation = (typeof SHIPPING_RULE_VIOLATIONS)[number];
