import { z } from "zod";
import { timestampSchema, uuidSchema } from "../../common/openapi-formats.js";
import { MAX_CREDENTIAL_LENGTH } from "../../auth/auth.schemas.js";
import { cartNoticeSchema } from "../../cart/cart.schemas.js";

export { changePasswordSchema, loginSchema } from "../../auth/auth.schemas.js";
export type { ChangePasswordBody, LoginBody } from "../../auth/auth.schemas.js";

// Schemas check structure only. Email format, password policy, names and phone are core functions run by the
// service, so the rules exist once and the error codes are the core's. The text bound only limits the work done on
// a hostile body (scrypt input, normalization), like the admin auth schemas.
const boundedText = z.string().max(MAX_CREDENTIAL_LENGTH);

/** `POST /store/account/register`. */
export const registerSchema = z.strictObject({
  email: boundedText,
  password: boundedText,
  firstName: boundedText,
  lastName: boundedText,
  phone: boundedText.optional(),
});

/**
 * `PATCH /store/account/me`. Names and phone only: the email is the identity (not editable in v1), the password
 * goes through `change-password`, and activity, lockout and ids are not a customer's to send (strict: 400).
 * `phone: null` removes the phone.
 */
export const updateProfileSchema = z.strictObject({
  firstName: boundedText.optional(),
  lastName: boundedText.optional(),
  phone: boundedText.nullable().optional(),
});

/** A customer as the store shows them to themselves: no hash, no lockout state, no activity flag. */
export const customerResponseSchema = z.object({
  id: uuidSchema,
  email: z.string(),
  /** Whether the address was confirmed with a verification link (ADR 0031). Unlocks nothing in v1. */
  emailVerified: z.boolean(),
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string().nullable(),
  createdAt: timestampSchema,
});

export const accountResponseSchema = z.object({ customer: customerResponseSchema });

/**
 * Register and login: the customer plus what the merge of the guest cart did. `cartNotices` is always present and empty
 * when nothing was capped or dropped (or there was no guest cart).
 */
export const signInResponseSchema = z.object({
  customer: customerResponseSchema,
  cartNotices: z.array(cartNoticeSchema),
});

export type RegisterBody = z.output<typeof registerSchema>;
export type UpdateProfileBody = z.output<typeof updateProfileSchema>;
export type CustomerResponse = z.output<typeof customerResponseSchema>;
export type AccountResponse = z.output<typeof accountResponseSchema>;
export type SignInResponse = z.output<typeof signInResponseSchema>;
