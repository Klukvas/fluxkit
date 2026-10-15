export const EMAIL_MAX_LENGTH = 254;

export type EmailValidationResult =
  | { readonly ok: true; readonly email: string }
  | {
      readonly ok: false;
      readonly reason: "not_a_string" | "empty" | "too_long" | "invalid_format";
    };

/** The API stores and compares this form, so "Admin@X.com" and "admin@x.com" are one account. */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

const WHITESPACE = /\s/u;

function hasForbiddenCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    // Whitespace of any Unicode kind, C0 and C1 control characters, DEL.
    if (WHITESPACE.test(character) || code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }
  }
  return false;
}

/** A deliberately small check, not the RFC: delivery of a real mail is the only true validation. */
export function validateEmail(input: string): EmailValidationResult {
  if (typeof input !== "string") {
    return { ok: false, reason: "not_a_string" };
  }
  const email = normalizeEmail(input);
  if (email.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (email.length > EMAIL_MAX_LENGTH) {
    return { ok: false, reason: "too_long" };
  }
  if (hasForbiddenCharacter(email)) {
    return { ok: false, reason: "invalid_format" };
  }
  const parts = email.split("@");
  if (parts.length !== 2) {
    return { ok: false, reason: "invalid_format" };
  }
  const [local, domain] = parts as [string, string];
  if (
    local.length === 0 ||
    domain.length === 0 ||
    !domain.includes(".") ||
    domain.startsWith(".") ||
    domain.endsWith(".") ||
    domain.includes("..")
  ) {
    return { ok: false, reason: "invalid_format" };
  }
  return { ok: true, email };
}
