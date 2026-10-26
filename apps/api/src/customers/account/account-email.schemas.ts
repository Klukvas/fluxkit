import { z } from "zod";
import { MAX_CREDENTIAL_LENGTH } from "../../auth/auth.schemas.js";

// Structure only, strict: the email rule, the locale list, the token format and the password policy are checked by the
// service with the core rules, so a hostile value gets the same field codes everywhere. The bounds only limit the work
// done on a hostile body.
const boundedText = z.string().max(MAX_CREDENTIAL_LENGTH);
/** Longer than any configured locale (`LOCALE_PATTERN`), short enough to bound the work. */
const localeText = z.string().max(35);
/** A derived token has 43 characters; anything longer is refused by the format check anyway. */
const tokenText = z.string().max(128);

/** `POST /store/account/password-reset`: the address to send the link to and the language of the mail. */
export const passwordResetRequestSchema = z.strictObject({
  email: boundedText,
  locale: localeText,
});

/** `POST /store/account/password-reset/confirm`: the token from the link fragment and the new password. */
export const passwordResetConfirmSchema = z.strictObject({
  token: tokenText,
  newPassword: boundedText,
});

/** `POST /store/account/verify-email`: the token from the link fragment. */
export const verifyEmailSchema = z.strictObject({ token: tokenText });

/** The answer of the reset request: always the same empty object. */
export const passwordResetAcceptedSchema = z.strictObject({});

export type PasswordResetRequestBody = z.output<typeof passwordResetRequestSchema>;
export type PasswordResetConfirmBody = z.output<typeof passwordResetConfirmSchema>;
export type VerifyEmailBody = z.output<typeof verifyEmailSchema>;
export type PasswordResetAccepted = z.output<typeof passwordResetAcceptedSchema>;
