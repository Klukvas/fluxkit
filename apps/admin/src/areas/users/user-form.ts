import type { AdminRole, CreateAdminUserBody, ProblemDetails } from "@fluxkit/api-client";
import { fieldErrorsFromProblem, type FormErrors } from "../../lib/form-errors";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { passwordProblems } from "./password-policy";

/**
 * The create and reset-password form models (pure). The values live only in the form component's own state while it is
 * on screen: never in the URL, storage, a log or page-level state, and the password is cleared after every answer.
 */

/** `EMAIL_MAX_LENGTH` of core (the API trims and lower-cases, then checks the format). */
export const EMAIL_MAX_LENGTH = 254;

export type CreateField = "email" | "role" | "password";

export interface CreateUserValues {
  email: string;
  role: AdminRole;
  password: string;
}

/** The least powerful role is preselected; the owner chooses another on purpose. */
export const EMPTY_CREATE_VALUES: CreateUserValues = { email: "", role: "viewer", password: "" };

/** Whether leaving would discard typed input (the unsaved-changes guard). */
export function isCreateDirty(values: CreateUserValues): boolean {
  return (
    values.email !== EMPTY_CREATE_VALUES.email ||
    values.password !== EMPTY_CREATE_VALUES.password ||
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
  return errors;
}

/** `POST /admin/users`: exactly email (trimmed; the API lower-cases), role and password. */
export function createBody(values: CreateUserValues): CreateAdminUserBody {
  return { email: values.email.trim(), role: values.role, password: values.password };
}

/** A `409 conflict` on `email` (another user has it, in any case) goes on the email field; the rest as usual. */
export function createErrorsFromProblem(
  status: number,
  problem: ProblemDetails,
): FormErrors<CreateField> {
  if (status === 409 && problem.code === "conflict" && problem.field === "email") {
    return { fields: { email: { key: "user.create.emailTaken" } }, other: [] };
  }
  return fieldErrorsFromProblem(problem, ["email", "role", "password"], status);
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

export function resetErrorsFromProblem(
  status: number,
  problem: ProblemDetails,
): FormErrors<ResetField> {
  return fieldErrorsFromProblem(problem, ["newPassword"], status);
}

/** Two emails as the API stores and compares them (trimmed, lower case). */
export function sameEmail(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
