import type { TranslationValues } from "@fluxkit/ui";
import type { Failure } from "./failure";

/**
 * Problem answers of the admin API are shown through translated messages only. The API's `detail` and `message` texts
 * are English and not contract (docs/contracts/api.md); they are never rendered. Two namespaces:
 *   `errors.code.<code>`     the problem `code` (every value of `ProblemDetailsDoc.code` in docs/api/openapi.json)
 *   `errors.reason.<code>`   a core reason: the `rule` of a `rule_violation`, or the `code` of an `errors[]` entry (the API
 *                            documents both as "the core reason code", so one message serves both)
 * Unknown codes show `errors.generic` plus the code in small print (`errors.reference`): admins need it for support.
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
] as const;

/**
 * Rules and field error codes the admin pages of `docs/api/` document (catalog, pricing, inventory, orders, customers,
 * auth). A test scans those pages and fails on a snake-case word that is neither here nor in its list of non-codes.
 */
export const KNOWN_REASON_CODES = [
  // request schema
  "required",
  "unknown_field",
  "invalid_type",
  "invalid_format",
  "invalid_value",
  "invalid",
  "empty",
  "too_small",
  "too_big",
  "too_short",
  "too_long",
  "invalid_reference",
  // auth and customers
  "incorrect",
  "equals_email",
  "contains_nul",
  "same_as_current",
  "last_owner_cannot_be_demoted",
  "last_owner_cannot_be_deactivated",
  // catalog
  "title_invalid",
  "slug_missing",
  "default_locale_missing",
  "attribute_invalid",
  "attribute_assigned",
  "attribute_assignment_in_use",
  "attribute_option_in_use",
  "input_type_immutable",
  "is_localized_immutable",
  "unit_in_use",
  "level_in_use",
  "option_assigned_to_product_type",
  "option_in_use_by_products",
  "option_value_in_use",
  "option_not_allowed",
  "option_pair_incomplete",
  "options_frozen",
  "too_many_options",
  "duplicate_value",
  "product_type_in_use",
  "product_type_immutable",
  "product_not_draft",
  "product_was_published",
  "product_title_missing",
  "max_depth_exceeded",
  "moved_under_itself",
  "would_create_cycle",
  "last_variant",
  "default_variant",
  "default_variant_inactive",
  "no_default_variant",
  "has_stock_history",
  "has_order_lines",
  // pricing
  "price_missing",
  "last_shop_price",
  "unsupported_currency",
  "not_an_integer",
  "negative_amount",
  "amount_out_of_range",
  "compare_at_not_an_integer",
  "compare_at_out_of_range",
  "compare_at_not_greater",
  "duplicate_item",
  // inventory
  "delta_or_set_on_hand",
  "invalid_quantity",
  "on_hand_out_of_range",
  "negative_on_hand",
  "below_reserved",
  "no_change",
  "kind_requires_increase",
  "not_tracked",
  "insufficient_stock",
  "reserved_out_of_range",
  "variant_not_found",
  "variant_not_sellable",
  "location_not_found",
  "reservation_not_found",
  "not_active",
  "already_committed",
  "level_inconsistent",
  "would_shorten",
  // orders
  "invalid_transition",
  "awaiting_stock",
  "amount_mismatch",
  "order_not_found",
  "order_not_payable",
  "payment_reference_conflict",
  "idempotency_key_required",
  "invalid_idempotency_key",
  "shipping_address_required",
  "line_total_out_of_range",
  "subtotal_out_of_range",
] as const;

/** What to show: a message key with its values, and for an unknown code the code itself (small print). */
export interface MessageDescriptor {
  key: string;
  values?: TranslationValues;
  code?: string;
}

const GENERIC = "errors.generic";

function includes(list: readonly string[], value: string): boolean {
  return list.includes(value);
}

/** The shape of a problem this module reads; `detail` is deliberately absent. */
export interface ProblemLike {
  code: string;
  rule?: string | undefined;
}

export function describeProblem(status: number, problem: ProblemLike): MessageDescriptor {
  // A 413 has no dedicated code (the API keeps the status and sends a generic one): its own message.
  if (status === 413) return { key: "errors.payloadTooLarge" };
  const known = includes(KNOWN_PROBLEM_CODES, problem.code);
  if (problem.code === "rule_violation" && problem.rule !== undefined) {
    return includes(KNOWN_REASON_CODES, problem.rule)
      ? { key: `errors.reason.${problem.rule}` }
      : { key: "errors.code.rule_violation", code: problem.rule };
  }
  return known ? { key: `errors.code.${problem.code}` } : { key: GENERIC, code: problem.code };
}

export function describeFieldError(code: string): MessageDescriptor {
  return includes(KNOWN_REASON_CODES, code)
    ? { key: `errors.reason.${code}` }
    : { key: GENERIC, code };
}

export function describeFailure(failure: Failure): MessageDescriptor {
  switch (failure.kind) {
    case "problem":
      return describeProblem(failure.status, failure.problem);
    case "network":
      return { key: "errors.network" };
    case "timeout":
      return { key: "errors.timeout" };
    case "invalidResponse":
      return { key: "errors.invalidResponse" };
  }
}
