export const PASSWORD_LIMITS = Object.freeze({ minLength: 12, maxLength: 128 });

export type PasswordErrorCode =
  "not_a_string" | "too_short" | "too_long" | "equals_email" | "contains_nul";

export type PasswordValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly { readonly code: PasswordErrorCode }[] };

/** Length counts code points (an emoji is one character), not UTF-16 units. */
function codePointCount(value: string): number {
  return Array.from(value).length;
}

/** No composition rules (length is what matters); rejects the email as password and NUL (Postgres/driver hazard). */
export function validatePassword(
  password: string,
  context: { readonly email: string },
): PasswordValidationResult {
  if (typeof password !== "string") {
    return { ok: false, errors: [{ code: "not_a_string" }] };
  }
  const errors: { code: PasswordErrorCode }[] = [];
  const length = codePointCount(password);
  if (length < PASSWORD_LIMITS.minLength) {
    errors.push({ code: "too_short" });
  }
  if (length > PASSWORD_LIMITS.maxLength) {
    errors.push({ code: "too_long" });
  }
  if (
    typeof context.email === "string" &&
    password.trim().toLowerCase() === context.email.trim().toLowerCase()
  ) {
    errors.push({ code: "equals_email" });
  }
  if (password.includes("\u0000")) {
    errors.push({ code: "contains_nul" });
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
