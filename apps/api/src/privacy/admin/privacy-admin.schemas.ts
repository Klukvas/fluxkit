import {
  CATALOG_LIMITS,
  EMAIL_MAX_LENGTH,
  PRIVACY_REQUEST_CHANNELS,
  PRIVACY_REQUEST_KINDS,
  PRIVACY_REQUEST_STATUSES,
  PRIVACY_REQUEST_SUBJECT_KINDS,
  ORDER_STATUSES,
} from "@fluxkit/core";
import { z } from "zod";
import { timestampSchema, uuidSchema } from "../../common/openapi-formats.js";
import { trimmedText } from "../../orders/admin/admin-orders.schemas.js";

// Admin privacy API shapes (docs/api/privacy.md, ADR 0033 decision 10). Emails travel in bodies only, never in a URL.

export const PRIVACY_NOTE_MAX_LENGTH = 500;
export const PRIVACY_REQUESTS_DEFAULT_PAGE_SIZE = 50;

const integerString = z.string().regex(/^\d{1,9}$/, "must be a non-negative integer");

/** An email as typed; the service normalizes it and checks the format with core `validateEmail`. */
const emailInput = z.string().max(EMAIL_MAX_LENGTH);

/** `POST /admin/privacy/lookup`. */
export const lookupBodySchema = z.strictObject({ email: emailInput });
export type LookupBody = z.output<typeof lookupBodySchema>;

/** `POST /admin/privacy/requests`. The subject is an account id or an email (the email is stored only as an HMAC). */
export const createRequestBodySchema = z.strictObject({
  kind: z.enum(PRIVACY_REQUEST_KINDS),
  subject: z.union([
    z.strictObject({ customerId: z.guid().meta({ format: "uuid" }) }),
    z.strictObject({ email: emailInput }),
  ]),
  note: trimmedText(PRIVACY_NOTE_MAX_LENGTH).optional().meta({
    description:
      "How the identity was checked; 1 to 500 characters, trimmed. No personal data (no copies of documents).",
  }),
});
export type CreateRequestBody = z.output<typeof createRequestBodySchema>;

/**
 * `POST /admin/privacy/requests/{id}/export`. The address of an email subject is not stored (only its HMAC), so the admin
 * types it again; it must match the request. A customer subject sends `{}`.
 */
export const exportBodySchema = z.strictObject({ email: emailInput.optional() });
export type ExportBody = z.output<typeof exportBodySchema>;

/** `POST /admin/privacy/requests/{id}/erase-preview`: the email again for an email subject, as for the export. */
export const erasePreviewBodySchema = exportBodySchema;
export type ErasePreviewBody = ExportBody;

/** `POST /admin/privacy/requests/{id}/erase`: irreversible, so `confirm: true` is required. */
export const eraseBodySchema = z.strictObject({
  email: emailInput.optional(),
  confirm: z.literal(true).meta({ description: "Must be true: the erasure cannot be undone." }),
});
export type EraseBody = z.output<typeof eraseBodySchema>;

/** `POST /admin/privacy/requests/{id}/reject`. */
export const rejectBodySchema = z.strictObject({
  reasonCode: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,63}$/, "must be a lower-case code")
    .meta({ description: "A code, for example `identity_not_confirmed` or `duplicate`." }),
  note: trimmedText(PRIVACY_NOTE_MAX_LENGTH).optional(),
});
export type RejectBody = z.output<typeof rejectBodySchema>;

export const erasePreviewSchema = z.object({
  accountFound: z.boolean(),
  orders: z.number().int().min(0),
  ordersToAnonymise: z.number().int().min(0),
  mail: z.number().int().min(0),
  blockers: z.array(
    z.object({
      orderNumber: z.string().nullable(),
      reason: z.enum([
        "open_order",
        "payment_in_progress",
        "refund_in_progress",
        "active_shipment",
        "mail_sending",
      ]),
    }),
  ),
  reasons: z.array(
    z.enum([
      "open_order",
      "payment_in_progress",
      "refund_in_progress",
      "active_shipment",
      "mail_sending",
    ]),
  ),
});
export type ErasePreviewView = z.output<typeof erasePreviewSchema>;

/** `GET /admin/privacy/requests`. */
export const listRequestsQuerySchema = z.strictObject({
  limit: integerString
    .transform(Number)
    .pipe(z.number().int().min(1).max(CATALOG_LIMITS.maxPageSize))
    .default(PRIVACY_REQUESTS_DEFAULT_PAGE_SIZE),
  offset: integerString
    .transform(Number)
    .pipe(z.number().int().min(0).max(CATALOG_LIMITS.maxOffset))
    .default(0),
  status: z.enum(PRIVACY_REQUEST_STATUSES).optional(),
});
export type ListRequestsQuery = z.output<typeof listRequestsQuerySchema>;

const resultValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);

export const privacyRequestSchema = z.object({
  id: uuidSchema,
  kind: z.enum(PRIVACY_REQUEST_KINDS),
  subjectKind: z.enum(PRIVACY_REQUEST_SUBJECT_KINDS),
  subjectCustomerId: uuidSchema.nullable().meta({
    description: "The account of a customer subject (it may no longer exist after an erasure).",
  }),
  channel: z.enum(PRIVACY_REQUEST_CHANNELS),
  status: z.enum(PRIVACY_REQUEST_STATUSES),
  receivedAt: timestampSchema,
  dueAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
  overdue: z.boolean().meta({ description: "Open and past its due time." }),
  result: z
    .record(z.string(), resultValue)
    .nullable()
    .meta({ description: "Counts, codes and erased order numbers; never contact data." }),
  note: z.string().nullable(),
  handledBy: uuidSchema.nullable(),
});
export type PrivacyRequestView = z.output<typeof privacyRequestSchema>;

export const lookupResultSchema = z.object({
  customer: z
    .object({
      id: uuidSchema,
      email: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      isActive: z.boolean(),
      createdAt: timestampSchema,
      orderCount: z.number().int().min(0),
    })
    .nullable()
    .meta({ description: "The account with this email, or null." }),
  guestOrders: z
    .array(
      z.object({
        id: uuidSchema,
        number: z.string(),
        status: z.enum(ORDER_STATUSES),
        placedAt: timestampSchema,
        contactErased: z.boolean(),
      }),
    )
    .meta({ description: "Orders with this email that belong to no account, oldest first." }),
  mailCount: z.number().int().min(0),
  openRequests: z.array(privacyRequestSchema),
});
export type LookupResult = z.output<typeof lookupResultSchema>;
