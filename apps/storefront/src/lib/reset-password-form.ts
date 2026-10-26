import { clientFailure, type Failure } from "./failure";

/**
 * The one rule the reset form checks itself: the two password fields are equal. Length, the email rule and the characters are
 * the API's to judge (the registration policy, `errors.field.*`), so the form never disagrees with the server. Compared
 * exactly: a password is not trimmed or case-folded.
 */
export function checkNewPasswords(values: {
  newPassword: string;
  confirmPassword: string;
}): Failure | null {
  if (values.newPassword === values.confirmPassword) return null;
  return clientFailure("errors.validation_failed", [
    { path: "confirmPassword", code: "mismatch", messageKey: "account.reset.mismatch" },
  ]);
}
