import { PASSWORD_LIMITS } from "../account/password-form";

/**
 * The password policy as the API applies it to a new user's `password` and to `newPassword` of a reset (core's
 * `validatePassword`: 12 to 128 characters counted as code points, not the account's email (trimmed, any case), no NUL;
 * no composition rules). The limits come from the account area (`PASSWORD_LIMITS`, compared with core there); the check
 * is copied because the SPA does not bundle core, and `password-policy.spec.ts` compares it with core over many inputs.
 * Early feedback only: the server decides and its answer is shown on the field.
 */

/** The reasons core reports for a string, in core's order (`not_a_string` cannot happen for a form value). */
export type PasswordProblem = "too_short" | "too_long" | "equals_email" | "contains_nul";

/** Characters as core counts them: code points (an emoji is one). */
export function passwordLength(password: string): number {
  return Array.from(password).length;
}

export function passwordProblems(password: string, email: string): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  const length = passwordLength(password);
  if (length < PASSWORD_LIMITS.minLength) problems.push("too_short");
  if (length > PASSWORD_LIMITS.maxLength) problems.push("too_long");
  if (password.trim().toLowerCase() === email.trim().toLowerCase()) problems.push("equals_email");
  if (password.includes("\u0000")) problems.push("contains_nul");
  return problems;
}

export interface PasswordFeedback {
  /** Characters typed, as core counts them. */
  length: number;
  min: number;
  max: number;
  /** The rules a person can act on while typing, each met or not (NUL cannot be typed; it is still refused on submit). */
  rules: { id: "length" | "notEmail"; met: boolean }[];
}

/** What the field says under itself while the owner types (a live region announces it politely). */
export function passwordFeedback(password: string, email: string): PasswordFeedback {
  const problems = passwordProblems(password, email);
  return {
    length: passwordLength(password),
    min: PASSWORD_LIMITS.minLength,
    max: PASSWORD_LIMITS.maxLength,
    rules: [
      { id: "length", met: !problems.includes("too_short") && !problems.includes("too_long") },
      { id: "notEmail", met: !problems.includes("equals_email") },
    ],
  };
}
