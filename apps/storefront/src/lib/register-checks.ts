import { clientFailure, type Failure, type FieldFailure } from "./failure";

/**
 * The registration form's own checks before anything is sent (review D-06, 2026-11-02): the email shape and the password
 * rules of the API, reported together with the blank required fields so the shopper fixes everything in one pass. Copies of
 * core's rules (`packages/core/src/auth/email.ts` `validateEmail`, `password-policy.ts`; the storefront does not import
 * core, `client-boundary.spec.ts`); the spec compares the limits with core's source. The API stays the judge: its answer
 * for each field is still shown. A blank field is left to the required check.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
const EMAIL_MAX_LENGTH = 254;

function isEmailShape(input: string): boolean {
  const email = input.trim().toLowerCase();
  if (email.length > EMAIL_MAX_LENGTH) return false;
  for (const character of email) {
    const code = character.codePointAt(0) ?? 0;
    if (/\s/u.test(character) || code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return false;
  }
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts as [string, string];
  return (
    local.length > 0 &&
    domain.includes(".") &&
    !domain.startsWith(".") &&
    !domain.endsWith(".") &&
    !domain.includes("..")
  );
}

export function registerFieldChecks(values: { email: string; password: string }): Failure | null {
  const errors: FieldFailure[] = [];
  if (values.email.trim() !== "" && !isEmailShape(values.email)) {
    errors.push({
      path: "email",
      code: "invalid_format",
      messageKey: "account.register.error.email",
    });
  }
  if (values.password !== "") {
    const length = Array.from(values.password).length;
    if (length < PASSWORD_MIN_LENGTH) {
      errors.push({
        path: "password",
        code: "too_short",
        messageKey: "account.register.error.passwordShort",
      });
    } else if (length > PASSWORD_MAX_LENGTH) {
      errors.push({
        path: "password",
        code: "too_long",
        messageKey: "account.register.error.passwordLong",
      });
    } else if (values.password.trim().toLowerCase() === values.email.trim().toLowerCase()) {
      errors.push({
        path: "password",
        code: "equals_email",
        messageKey: "errors.field.equals_email",
      });
    }
  }
  return errors.length === 0 ? null : clientFailure("errors.validation_failed", errors);
}
