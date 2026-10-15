import { PERMISSIONS, ROLES } from "@fluxkit/core";
import { z } from "zod";
import { timestampSchema, uuidSchema } from "../common/openapi-formats.js";

/**
 * Structural limit of every secret or email a client sends to an auth endpoint. It only bounds the work done on a
 * hostile body (scrypt input, email normalization); the real rules (password policy, email format) are core
 * functions that run in the services, so a login with a wrong-looking value follows the normal failure path.
 */
export const MAX_CREDENTIAL_LENGTH = 1024;

const credentialText = z.string().max(MAX_CREDENTIAL_LENGTH);

/** `POST /admin/auth/login`. */
export const loginSchema = z.strictObject({
  email: credentialText,
  password: credentialText,
});

/** `POST /admin/auth/change-password`. The new password's policy runs in the service (core `validatePassword`). */
export const changePasswordSchema = z.strictObject({
  currentPassword: credentialText,
  newPassword: credentialText,
});

/** What every auth response says about a user. No hash, no lockout state. */
export const authUserSchema = z.object({
  id: uuidSchema,
  email: z.string(),
  role: z.enum(ROLES),
  isActive: z.boolean(),
  lastLoginAt: timestampSchema.nullable(),
});

export const loginResponseSchema = z.object({ user: authUserSchema });

export const meResponseSchema = z.object({
  user: authUserSchema,
  permissions: z.array(z.enum(PERMISSIONS)),
});

export type LoginBody = z.output<typeof loginSchema>;
export type ChangePasswordBody = z.output<typeof changePasswordSchema>;
export type AuthUserResponse = z.output<typeof authUserSchema>;
export type LoginResponse = z.output<typeof loginResponseSchema>;
export type MeResponse = z.output<typeof meResponseSchema>;
