import type { ProblemDetails } from "@fluxkit/api-client";
import { fieldErrorsFromProblem, type FormErrors } from "../../lib/form-errors";
import {
  describeFieldError,
  describeProblem,
  type MessageDescriptor,
} from "../../lib/problem-messages";

/**
 * How the shipping settings screens explain what the API answered (`docs/api/shipping.md`). The API's English `detail` is
 * never shown. The reasons below are specific to shipping, so their messages live in this area's lazy file
 * (`ship.reason.*`, `ship.refusal.*`); every other code goes through the shell's problem map.
 */

/** Field reasons of the method and provider-settings routes that have a message of their own. */
export const SHIPPING_REASONS = [
  // pricing (core `validateShippingPricing`)
  "unknown_type",
  "out_of_range",
  "no_tiers",
  "too_many_tiers",
  "first_tier_not_zero",
  "tiers_not_sorted",
  "duplicate_tier",
  "not_an_array",
  "not_an_object",
  // method
  "provider_required",
  "provider_not_enabled",
  "provider_lacks_pickup_points",
  "duplicate_country",
  // provider settings
  "invalid_key",
  "secret_not_allowed",
  "too_deep",
  "too_many_keys",
  "too_many_items",
  "unsafe_text",
  "not_finite",
  "too_large",
] as const;

export function describeShippingReason(code: string): MessageDescriptor {
  return (SHIPPING_REASONS as readonly string[]).includes(code)
    ? { key: `ship.reason.${code}` }
    : describeFieldError(code);
}

/** `countryCodes.3` is one field: the list. Every other path is the field's own. */
export function fieldOfPath(path: string): string {
  return /^countryCodes\.\d+$/.test(path) ? "countryCodes" : path;
}

/**
 * A problem on the method form: each `errors[].path` on the field of that name (the first error of a field wins) with the
 * shipping reason's message; a `409 conflict` on `code` on the code field; whatever has no field goes to the summary.
 */
export function methodProblemMapper(
  problem: ProblemDetails,
  status: number,
  formFields: readonly string[],
): FormErrors<string> {
  if (
    problem.code === "conflict" &&
    problem.field !== undefined &&
    formFields.includes(problem.field)
  ) {
    return { fields: { [problem.field]: { key: "ship.error.codeTaken" } }, other: [] };
  }
  if (problem.errors === undefined || problem.errors.length === 0) {
    return fieldErrorsFromProblem(problem, formFields, status);
  }
  const fields: Partial<Record<string, MessageDescriptor>> = {};
  const other: MessageDescriptor[] = [];
  for (const error of problem.errors) {
    const descriptor = describeShippingReason(error.code);
    const path = fieldOfPath(error.path);
    if (!formFields.includes(path)) other.push(descriptor);
    else if (fields[path] === undefined) fields[path] = descriptor;
  }
  return { fields, other };
}

/** The rules a method delete can be refused with that get their own explanation. */
export const METHOD_REFUSAL_RULES = ["method_in_use"] as const;

/** A refusal of the delete: `method_in_use` says what to do instead; everything else is the shell's message. */
export function describeMethodRefusal(status: number, problem: ProblemDetails): MessageDescriptor {
  if (
    problem.code === "rule_violation" &&
    (METHOD_REFUSAL_RULES as readonly string[]).includes(problem.rule ?? "")
  ) {
    return { key: `ship.refusal.${problem.rule as string}` };
  }
  return describeProblem(status, problem);
}

/** The delete's problem mapper for `useFormSubmit`: one message in the summary. */
export function deleteProblemMapper(problem: ProblemDetails, status: number): FormErrors<string> {
  return { fields: {}, other: [describeMethodRefusal(status, problem)] };
}

/** Why a provider's connection check failed, as the API names it (a typed reason, never carrier text). */
export const CHECK_REASONS = [
  "unavailable",
  "rejected",
  "invalid_credentials",
  "not_supported",
] as const;

/** Raw carrier codes of an answer, kept only when they have the documented shape (short, no spaces). */
export function safeProviderCodes(codes: readonly string[] | undefined): string[] {
  return (codes ?? []).filter((code) => /^[A-Za-z0-9_.-]{1,32}$/.test(code));
}
