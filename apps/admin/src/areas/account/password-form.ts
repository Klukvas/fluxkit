import type { MessageDescriptor } from "../../lib/problem-messages";

/**
 * The password policy as the API applies it (`@fluxkit/core` `PASSWORD_LIMITS`, counted in code points). Copied, not
 * imported: importing core pulls zod into the bundle (see `lib/format.ts`). `password-form.spec.ts` compares the values.
 * Only early feedback (native `minLength`, `maxLength`): the server decides and its answer is shown.
 */
export const PASSWORD_LIMITS = { minLength: 12, maxLength: 128 } as const;

export type PasswordField = "currentPassword" | "newPassword" | "repeatPassword";

export interface PasswordFormValues {
  currentPassword: string;
  newPassword: string;
  repeatPassword: string;
}

/** Checks the browser can make before sending: the repeated password must match. */
export function localPasswordErrors(
  values: PasswordFormValues,
): Partial<Record<PasswordField, MessageDescriptor>> {
  return values.repeatPassword !== values.newPassword
    ? { repeatPassword: { key: "account.password.mismatch" } }
    : {};
}

/** Whether leaving would discard typed input (the unsaved-changes guard). */
export function isPasswordFormDirty(values: PasswordFormValues): boolean {
  return values.currentPassword !== "" || values.newPassword !== "" || values.repeatPassword !== "";
}
