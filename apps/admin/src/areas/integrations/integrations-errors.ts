import type { ProblemDetails } from "@fluxkit/api-client";
import {
  describeFieldError,
  describeProblem,
  type MessageDescriptor,
} from "../../lib/problem-messages";
import { retryAfterMinutes } from "../../lib/retry-after";

/**
 * How the Integrations screen explains what the API answered to a save or a removal (`docs/api/integrations.md`). The
 * API's English `detail` and `errors[].message` are never shown. The refusals below are specific to this area, so their
 * messages live in its lazy file (`intg.refusal.*`, `intg.error.*`); every other answer goes through the shell's map.
 */

export const SECRET_FORM_FIELDS = ["value", "currentPassword"] as const;
export type SecretFormField = (typeof SECRET_FORM_FIELDS)[number];

/** The `rule` of a 403 that means "the password was wrong", not "the role may not do this". */
export const PASSWORD_INCORRECT_RULE = "current_password_incorrect";
export const REVISION_STALE_RULE = "integration_revision_stale";

/** The `rule` of a `409` (`rule_violation`, or `invalid_transition` for the last one) and of the `503`. */
export const INTEGRATION_REFUSAL_RULES = [
  "integration_storage_disabled",
  "integration_env_override",
  REVISION_STALE_RULE,
  "integration_unavailable",
  "integration_version_not_retirable",
  "step_up_unavailable",
] as const;

/** The codes of a `value` error with a message of their own. */
export const VALUE_ERROR_CODES = [
  "required",
  "too_long",
  "invalid_characters",
  "invalid_format",
] as const;

export interface SecretFormErrors {
  fields: Partial<Record<SecretFormField, MessageDescriptor>>;
  /** Refusals that belong to no field: shown as an alert of the form. */
  form: MessageDescriptor[];
  /** Somebody changed the integrations since the last read: the screen reads them again. */
  stale: boolean;
}

function describeValueError(code: string): MessageDescriptor {
  return (VALUE_ERROR_CODES as readonly string[]).includes(code)
    ? { key: `intg.error.value.${code}` }
    : describeFieldError(code);
}

function describeRefusal(
  status: number,
  problem: ProblemDetails,
  retryAfter: string | null,
): MessageDescriptor {
  if (status === 429 || problem.code === "too_many_requests") {
    const minutes = retryAfterMinutes(retryAfter);
    return minutes === null
      ? { key: "intg.refusal.rateLimited" }
      : { key: "intg.refusal.rateLimitedWait", values: { minutes } };
  }
  if (
    problem.rule !== undefined &&
    (INTEGRATION_REFUSAL_RULES as readonly string[]).includes(problem.rule)
  ) {
    return { key: `intg.refusal.${problem.rule}` };
  }
  return describeProblem(status, problem);
}

/**
 * A refusal on the save or remove form: a wrong password on the password field (a 403 told apart from a missing
 * permission by its `rule`), each `errors[]` entry on its field (the first of a field wins), everything else on the form.
 */
export function secretProblemErrors(
  status: number,
  problem: ProblemDetails,
  retryAfter: string | null,
): SecretFormErrors {
  if (status === 403 && problem.rule === PASSWORD_INCORRECT_RULE) {
    return {
      fields: { currentPassword: { key: "intg.error.passwordIncorrect" } },
      form: [],
      stale: false,
    };
  }
  if (problem.code === "validation_failed" && (problem.errors?.length ?? 0) > 0) {
    const fields: Partial<Record<SecretFormField, MessageDescriptor>> = {};
    const form: MessageDescriptor[] = [];
    for (const error of problem.errors ?? []) {
      if (error.path === "value") fields.value ??= describeValueError(error.code);
      else if (error.path === "currentPassword") {
        fields.currentPassword ??= describeFieldError(error.code);
      } else form.push(describeFieldError(error.code));
    }
    return { fields, form, stale: false };
  }
  return {
    fields: {},
    form: [describeRefusal(status, problem, retryAfter)],
    stale: problem.rule === REVISION_STALE_RULE,
  };
}

/** What the form refuses before anything is sent, so an empty field never spends one of the few password attempts. */
export function localSecretErrors(
  values: Partial<Record<SecretFormField, string>>,
): Partial<Record<SecretFormField, MessageDescriptor>> {
  const errors: Partial<Record<SecretFormField, MessageDescriptor>> = {};
  if (values.value !== undefined && values.value.trim() === "") {
    errors.value = { key: "intg.error.value.required" };
  }
  if (values.currentPassword !== undefined && values.currentPassword === "") {
    errors.currentPassword = { key: "intg.error.passwordRequired" };
  }
  return errors;
}
