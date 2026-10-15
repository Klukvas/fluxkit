import { validatePassword, type PasswordErrorCode } from "@fluxkit/core";
import type { FieldError } from "../common/problem.js";

const PASSWORD_ERROR_MESSAGES: Readonly<Record<PasswordErrorCode, string>> = {
  not_a_string: "Must be text.",
  too_short: "Must have at least 12 characters.",
  too_long: "Must have at most 128 characters.",
  equals_email: "Must not be the email address.",
  contains_nul: "Must not contain the NUL character.",
};

/**
 * Field errors of a password that breaks the core policy, reported on `path` (`newPassword`, `password`).
 * Empty when the password is acceptable for an account with this email.
 */
export function passwordPolicyErrors(path: string, password: string, email: string): FieldError[] {
  const result = validatePassword(password, { email });
  if (result.ok) {
    return [];
  }
  return result.errors.map(({ code }) => ({ path, code, message: PASSWORD_ERROR_MESSAGES[code] }));
}
