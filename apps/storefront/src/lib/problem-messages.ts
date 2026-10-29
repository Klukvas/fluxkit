import type { Translator } from "@fluxkit/ui";

/**
 * Problem answers of the store API are shown through translated messages only. The API's `detail` and `message` texts are
 * English, not contract (docs/contracts/api.md) and are never rendered. Three namespaces keep the keys apart, because the
 * same word can be a problem code, a rule and a field error code (`invalid_transition`, `variant_not_sellable`):
 *   `errors.<code>`        the problem `code` (every value of `ProblemDetailsDoc.code`)
 *   `errors.rule.<rule>`   the `rule` of a `rule_violation`
 *   `errors.field.<code>`  the `code` of an `errors[]` entry
 * Anything unknown shows `errors.generic`; `errors.network` and `errors.invalidResponse` cover the client's thrown errors.
 */

/** Every `code` of the API's problem answers. A test compares this list with `docs/api/openapi.json`. */
export const KNOWN_PROBLEM_CODES = [
  "validation_failed",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "in_use",
  "invalid_transition",
  "rule_violation",
  "too_many_requests",
  "internal_error",
  "cart_empty",
  "cart_changed",
  "checkout_refused",
  "idempotency_key_reused",
  "too_many_open_orders",
  "service_unavailable",
  "storage_unavailable",
  "uploads_disabled",
  "shipping_method_required",
  "shipping_not_applicable",
  "shipping_changed",
  "shipping_provider_unavailable",
  "payment_provider_unavailable",
] as const;

/** Rules of `rule_violation` the store routes answer (docs/api/cart.md, docs/api/orders.md). */
export const KNOWN_RULES = [
  "variant_not_sellable",
  "quantity_limit",
  "too_many_lines",
  "line_total_out_of_range",
  "subtotal_out_of_range",
  "invalid_transition",
  "order_not_payable",
  "payment_in_progress",
  "payment_window_too_short",
  "payment_not_available",
  // the privacy routes (docs/api/privacy.md)
  "erasure_blocked",
  "export_too_large",
] as const;

/** Codes of `errors[]` entries the storefront's forms and cart can receive (docs/api/{cart,customers,orders}.md). */
export const FIELD_ERROR_CODES = [
  "required",
  "unknown_field",
  "invalid_type",
  "invalid_format",
  "invalid_value",
  "invalid",
  "too_small",
  "too_big",
  "too_short",
  "too_long",
  "empty",
  "not_a_string",
  "not_an_object",
  "invalid_characters",
  "invalid_quantity",
  "idempotency_key_required",
  "invalid_idempotency_key",
  "shipping_address_required",
  "unknown_pickup_point",
  "not_applicable",
  "insufficient_stock",
  "variant_not_sellable",
  "reserved_out_of_range",
  "line_total_out_of_range",
  "product_title_missing",
  "equals_email",
  "contains_nul",
  "same_as_current",
  "incorrect",
] as const;

const GENERIC_KEY = "errors.generic";

function includes(list: readonly string[], value: string): boolean {
  return list.includes(value);
}

/** The shape of `ProblemDetails` this module needs; `detail` is deliberately not read. */
export interface ProblemLike {
  code: string;
  rule?: string | undefined;
}

export interface FieldErrorLike {
  path?: string;
  code: string;
}

export interface MessageOptions {
  /** Receives the text for an unknown code. Defaults to `console.warn` in development and nothing elsewhere. */
  log?: (text: string) => void;
}

function defaultLog(text: string): void {
  if (process.env.NODE_ENV === "development") console.warn(text);
}

export function problemMessageKey(problem: ProblemLike): string {
  if (problem.code === "rule_violation" && problem.rule !== undefined) {
    if (includes(KNOWN_RULES, problem.rule)) return `errors.rule.${problem.rule}`;
  }
  return includes(KNOWN_PROBLEM_CODES, problem.code) ? `errors.${problem.code}` : GENERIC_KEY;
}

export function fieldErrorMessageKey(code: string): string {
  return includes(FIELD_ERROR_CODES, code) ? `errors.field.${code}` : GENERIC_KEY;
}

export function transportErrorMessageKey(kind: "network" | "timeout" | "invalidResponse"): string {
  return `errors.${kind}`;
}

export function problemMessage(
  t: Translator,
  problem: ProblemLike,
  options: MessageOptions = {},
): string {
  const key = problemMessageKey(problem);
  if (key === GENERIC_KEY) {
    (options.log ?? defaultLog)(
      `Unknown problem code "${problem.code}" (rule: ${problem.rule ?? "none"}).`,
    );
  }
  return t(key);
}

export function fieldErrorMessage(
  t: Translator,
  error: FieldErrorLike,
  options: MessageOptions = {},
): string {
  const key = fieldErrorMessageKey(error.code);
  if (key === GENERIC_KEY) {
    (options.log ?? defaultLog)(
      `Unknown field error code "${error.code}" at "${error.path ?? ""}".`,
    );
  }
  return t(key);
}
