import { EMAIL_MAX_LENGTH } from "@fluxkit/core";
import { z } from "zod";
import { timestampSchema, uuidSchema } from "../../common/openapi-formats.js";
import { paginationQuerySchema } from "../../common/pagination.js";

/** `GET /admin/customers`: `?limit`, `?offset` and `?q`, the start of the email (case and surrounding spaces do not matter). */
export const listCustomersQuerySchema = paginationQuerySchema.extend({
  q: z.string().max(EMAIL_MAX_LENGTH).optional(),
});

/**
 * `PATCH /admin/customers/:id`. Only activity can change here: the email is the identity, names and phone are the
 * customer's own, an admin cannot set a password (ADR 0016: deactivate or unlock only), lockout state has the
 * `unlock` route.
 */
export const updateCustomerSchema = z.strictObject({ isActive: z.boolean() });

/** A customer in a list: summary fields only. No hash, no lockout state. */
export const customerSummarySchema = z.object({
  id: uuidSchema,
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  isActive: z.boolean(),
  lastLoginAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});

/** One customer. `isLocked` is derived (the lock is in force now); the counters and dates behind it stay private. */
export const customerDetailSchema = customerSummarySchema.extend({
  phone: z.string().nullable(),
  isLocked: z.boolean(),
  orderCount: z.number().int().min(0),
  updatedAt: timestampSchema,
});

export type ListCustomersQuery = z.output<typeof listCustomersQuerySchema>;
export type UpdateCustomerBody = z.output<typeof updateCustomerSchema>;
export type CustomerSummary = z.output<typeof customerSummarySchema>;
export type CustomerDetail = z.output<typeof customerDetailSchema>;
