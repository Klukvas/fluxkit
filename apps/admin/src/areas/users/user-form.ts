import type { AdminRole, CreateAdminUserBody, ProblemDetails } from "@fluxkit/api-client";
import { fieldErrorsFromProblem, type FormErrors } from "../../lib/form-errors";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { passwordProblems } from "./password-policy";
import { describeUserRefusal, PASSWORD_INCORRECT_RULE } from "./user-actions";

/**
 * The create and reset-password form models (pure). The values live only in the form component's own state while it is
 * on screen: never in the URL, storage, a log or page-level state, and the password is cleared after every answer.
 */

/** `EMAIL_MAX_LENGTH` of core (the API trims and lower-cases, then checks the format). */
export const EMAIL_MAX_LENGTH = 254;

export const CREATE_FIELDS = ["email", "role", "password", "currentPassword"] as const;
export type CreateField = (typeof CREATE_FIELDS)[number];

export interface CreateUserValues {
  email: string;
  role: AdminRole;
  password: string;
  /** The signed-in admin's own password, asked for (and sent) only when the new role is `owner` (ADR 0058). */
  currentPassword: string;
}

/** The least powerful role is preselected; the owner chooses another on purpose. */
export const EMPTY_CREATE_VALUES: CreateUserValues = {
  email: "",
  role: "viewer",
  password: "",
  currentPassword: "",
};

/** A new owner is the one role the API asks for the actor's own password for. */
export function createNeedsStepUp(values: Pick<CreateUserValues, "role">): boolean {
  return values.role === "owner";
}

/** Whether leaving would discard typed input (the unsaved-changes guard). */
export function isCreateDirty(values: CreateUserValues): boolean {
  return (
    values.email !== EMPTY_CREATE_VALUES.email ||
    values.password !== EMPTY_CREATE_VALUES.password ||
    values.currentPassword !== EMPTY_CREATE_VALUES.currentPassword ||
    values.role !== EMPTY_CREATE_VALUES.role
  );
}

function policyError(password: string, email: string): MessageDescriptor | undefined {
  const first = passwordProblems(password, email)[0];
  return first === undefined ? undefined : { key: `errors.reason.${first}` };
}

/**
 * What the browser can refuse before sending: an empty or too long email, and a password that breaks the policy (core's
 * reasons, the messages the account area's form shows). The email format is the API's to judge (`invalid_format`).
 */
export function createFormErrors(
  values: CreateUserValues,
): Partial<Record<CreateField, MessageDescriptor>> {
  const errors: Partial<Record<CreateField, MessageDescriptor>> = {};
  const email = values.email.trim();
  if (email === "") errors.email = { key: "errors.reason.required" };
  else if (email.length > EMAIL_MAX_LENGTH) errors.email = { key: "errors.reason.too_long" };
  const password = policyError(values.password, values.email);
  if (password !== undefined) errors.password = password;
  // An empty re-entry would spend one of the five attempts the API allows per 15 minutes for nothing.
  if (createNeedsStepUp(values) && values.currentPassword === "") {
    errors.currentPassword = { key: "user.stepUp.required" };
  }
  return errors;
}

/**
 * `POST /admin/users`: exactly email (trimmed; the API lower-cases), role and password, plus the actor's own password
 * when (and only when) the new role is `owner`. A manager or viewer create sends three fields, as it always did.
 */
export function createBody(values: CreateUserValues): CreateAdminUserBody {
  return {
    email: values.email.trim(),
    role: values.role,
    password: values.password,
    ...(createNeedsStepUp(values) && values.currentPassword !== ""
      ? { currentPassword: values.currentPassword }
      : {}),
  };
}

/**
 * A `409 conflict` on `email` (another user has it, in any case) goes on the email field, a wrong current password on
 * that field, and a refusal without `errors[]` gets the area's own words (`describeUserRefusal`); the rest as usual.
 */
export function createErrorsFromProblem(
  status: number,
  problem: ProblemDetails,
): FormErrors<CreateField> {
  if (status === 409 && problem.code === "conflict" && problem.field === "email") {
    return { fields: { email: { key: "user.create.emailTaken" } }, other: [] };
  }
  if (status === 403 && problem.rule === PASSWORD_INCORRECT_RULE) {
    return {
      fields: { currentPassword: { key: `user.refusal.${PASSWORD_INCORRECT_RULE}` } },
      other: [],
    };
  }
  if ((problem.errors ?? []).length === 0) {
    return { fields: {}, other: [describeUserRefusal(status, problem)] };
  }
  return fieldErrorsFromProblem(problem, CREATE_FIELDS, status);
}

export type ResetField = "newPassword";

/** The new password checked against the target user's email (the API checks it against that email too). */
export function resetFormErrors(
  newPassword: string,
  email: string,
): Partial<Record<ResetField, MessageDescriptor>> {
  const error = policyError(newPassword, email);
  return error === undefined ? {} : { newPassword: error };
}

/**
 * The refusal of a reset. The form has no field for the actor's own password (it is typed in the confirmation), so a
 * problem about it, and every refusal without `errors[]` (a wrong password, the step-up rules), goes to the summary
 * with the area's own words.
 */
export function resetErrorsFromProblem(
  status: number,
  problem: ProblemDetails,
): FormErrors<ResetField> {
  const paths = (problem.errors ?? []).map((error) => error.path);
  if (paths.length === 0) {
    return { fields: {}, other: [describeUserRefusal(status, problem)] };
  }
  const mapped = fieldErrorsFromProblem(problem, ["newPassword"], status);
  return paths.includes("currentPassword")
    ? { fields: mapped.fields, other: [{ key: "user.stepUp.required" }] }
    : mapped;
}

/** Two emails as the API stores and compares them (trimmed, lower case). */
export function sameEmail(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
