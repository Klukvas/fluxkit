import { ROLES } from "@fluxkit/core";
import { z } from "zod";
import { timestampSchema, uuidSchema } from "../../common/openapi-formats.js";
import { paginationQuerySchema } from "../../common/pagination.js";
import { MAX_CREDENTIAL_LENGTH } from "../auth.schemas.js";

// Schemas check structure only. The email format and the password policy are core functions run by UsersService,
// so the rules exist once and the error codes are the core's.

const credentialText = z.string().max(MAX_CREDENTIAL_LENGTH);

/** `POST /admin/users`. The role must be one of the fixed roles of core. */
export const createUserSchema = z.strictObject({
  email: credentialText,
  role: z.enum(ROLES),
  password: credentialText,
});

/**
 * `PATCH /admin/users/:id`. Only role and activity can change here: the email is the identity, passwords go through
 * `reset-password`, lockout state is managed by the login flow.
 */
export const updateUserSchema = z.strictObject({
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
});

/** `POST /admin/users/:id/reset-password`. */
export const resetPasswordSchema = z.strictObject({
  newPassword: credentialText,
});

export const listUsersQuerySchema = paginationQuerySchema;

/** A user as the users endpoints show it: no hash, no lockout state. */
export const userResponseSchema = z.object({
  id: uuidSchema,
  email: z.string(),
  role: z.enum(ROLES),
  isActive: z.boolean(),
  lastLoginAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type CreateUserBody = z.output<typeof createUserSchema>;
export type UpdateUserBody = z.output<typeof updateUserSchema>;
export type ResetPasswordBody = z.output<typeof resetPasswordSchema>;
export type UserResponse = z.output<typeof userResponseSchema>;
