import {
  EMAIL_LOCALE_PATTERN,
  EMAIL_MESSAGE_STATUSES,
  EMAIL_RECIPIENT_KINDS,
  EMAIL_TEMPLATE_KEY_MAX_LENGTH,
  EMAIL_TEMPLATE_KEY_PATTERN,
  EMAIL_TEMPLATE_CATEGORIES,
} from "@fluxkit/core";
import { z } from "zod";
import { timestampSchema, uuidSchema } from "../../common/openapi-formats.js";
import { ADMIN_DEFAULT_PAGE_SIZE, paginationQuerySchema } from "../../common/pagination.js";

/** Longest recipient search text: an address (`EMAIL_MAX_LENGTH` of the account rules). */
export const RECIPIENT_FILTER_MAX_LENGTH = 254;

const localeSchema = z
  .string()
  .regex(EMAIL_LOCALE_PATTERN, "must be a locale such as uk or en")
  .meta({ description: "One of `LOCALES`." });

/** `POST /admin/email/test`. There is no recipient: the test goes to the signed-in admin's own address (ADR 0031 decision 15). */
export const sendTestEmailSchema = z.strictObject({
  locale: localeSchema.optional().meta({
    description: "Language of the test mail (one of `LOCALES`). Default: `DEFAULT_LOCALE`.",
  }),
});

const templateKeySchema = z
  .string()
  .max(EMAIL_TEMPLATE_KEY_MAX_LENGTH)
  .regex(EMAIL_TEMPLATE_KEY_PATTERN, "must be a template key such as order.placed");

const timestampQuery = z.iso
  .datetime({ message: "must be an ISO 8601 date-time such as 2030-03-01T10:00:00Z" })
  .transform((value) => new Date(value));

/**
 * `GET /admin/email/messages`: `limit` and `offset` as every admin list, filters by `status`, `template`, `orderId`,
 * `customerId`, a substring of the recipient address and a creation date range. Strict: a misspelt filter is a 400, not a
 * silently unfiltered list of personal data.
 */
export const listEmailMessagesQuerySchema = z
  .strictObject({
    ...paginationQuerySchema.shape,
    status: z.enum(EMAIL_MESSAGE_STATUSES).optional(),
    template: templateKeySchema.optional(),
    recipient: z.string().trim().min(1).max(RECIPIENT_FILTER_MAX_LENGTH).optional(),
    orderId: z.guid().optional(),
    customerId: z.guid().optional(),
    createdFrom: timestampQuery.optional(),
    createdTo: timestampQuery.optional(),
  })
  .refine(
    (query) =>
      query.createdFrom === undefined ||
      query.createdTo === undefined ||
      query.createdFrom.getTime() < query.createdTo.getTime(),
    {
      message: "createdFrom must be before createdTo",
      path: ["createdFrom"],
      params: { code: "invalid_range" },
    },
  );

export type ListEmailMessagesQuery = z.output<typeof listEmailMessagesQuerySchema>;

/** `GET /admin/email/templates/{key}/preview`. */
export const previewQuerySchema = z.strictObject({ locale: localeSchema.optional() });

export type PreviewQuery = z.output<typeof previewQuerySchema>;

export const templateKeyParamSchema = templateKeySchema;

const mailboxSchema = z.object({
  address: z.string(),
  displayName: z.string().nullable(),
});

const countsSchema = z.object(
  Object.fromEntries(
    EMAIL_MESSAGE_STATUSES.map((status) => [status, z.number().int().min(0)]),
  ) as Record<(typeof EMAIL_MESSAGE_STATUSES)[number], z.ZodNumber>,
);

export const emailStatusResponseSchema = z.object({
  configured: z.boolean().meta({
    description:
      "`false` with `EMAIL_PROVIDER=none`: nothing is sent and test send and resend answer 409.",
  }),
  providerCode: z.string().nullable(),
  from: mailboxSchema.nullable().meta({ description: "`EMAIL_FROM`." }),
  replyTo: mailboxSchema.nullable().meta({ description: "`EMAIL_REPLY_TO`." }),
  since: timestampSchema.meta({
    description: "Start of the 24 hour window of `counts` and `errorCodes`.",
  }),
  counts: countsSchema.meta({
    description: "Mails whose last change is inside the window, by status.",
  }),
  queueDepth: z
    .number()
    .int()
    .min(0)
    .meta({ description: "Mails pending or sending now, whatever their age." }),
  oldestPendingAt: timestampSchema
    .nullable()
    .meta({ description: "Creation time of the oldest pending mail." }),
  errorCodes: z.array(z.object({ code: z.string(), count: z.number().int().min(1) })).meta({
    description: "The most common `lastErrorCode` of the window (codes only; at most 10).",
  }),
});

export const emailMessageResponseSchema = z.object({
  id: uuidSchema,
  templateKey: z.string(),
  templateVersion: z.number().int(),
  locale: z.string(),
  to: z.string().meta({ description: "The recipient address (personal data; never logged)." }),
  recipientKind: z.enum(EMAIL_RECIPIENT_KINDS),
  customerId: uuidSchema.nullable(),
  orderId: uuidSchema.nullable(),
  adminUserId: uuidSchema.nullable(),
  status: z.enum(EMAIL_MESSAGE_STATUSES),
  attempts: z.number().int(),
  nextAttemptAt: timestampSchema,
  leaseUntil: timestampSchema.nullable(),
  deadlineAt: timestampSchema,
  providerCode: z.string().nullable(),
  providerMessageId: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  resendOf: uuidSchema.nullable(),
  createdByAdminId: uuidSchema.nullable(),
  createdAt: timestampSchema,
  sentAt: timestampSchema
    .nullable()
    .meta({ description: "Accepted by the provider (not necessarily delivered)." }),
  updatedAt: timestampSchema,
  canCancel: z.boolean().meta({ description: "`true` while the mail is pending." }),
  canResend: z.boolean().meta({
    description:
      "`true` for a final mail that is not an account mail of a customer. Does not look at the provider.",
  }),
});

export const emailMessageDetailResponseSchema = emailMessageResponseSchema.extend({
  variables: z.record(z.string(), z.unknown()).meta({
    description:
      "The frozen template input, redacted: every value of a `customer.*` mail and any value under a key that names a token, secret, password, key or link is `[redacted]`.",
  }),
});

export const emailMessagePageResponseSchema = z.object({
  items: z.array(emailMessageResponseSchema),
  total: z.number().int().min(0),
  limit: z
    .number()
    .int()
    .meta({ description: `Default ${String(ADMIN_DEFAULT_PAGE_SIZE)}.` }),
  offset: z.number().int(),
});

export const emailMessageIdResponseSchema = z.object({
  messageId: uuidSchema.meta({
    description: "The new outbox row. The attempt to send it starts after the answer.",
  }),
});

export const emailTemplateListResponseSchema = z.object({
  items: z.array(
    z.object({
      key: z.string(),
      version: z.number().int(),
      category: z.enum(EMAIL_TEMPLATE_CATEGORIES),
      locales: z
        .array(z.string())
        .meta({ description: "Locales the template has its own texts for." }),
    }),
  ),
});

export const emailPreviewResponseSchema = z.object({
  key: z.string(),
  version: z.number().int(),
  category: z.enum(EMAIL_TEMPLATE_CATEGORIES),
  locale: z.string(),
  subject: z.string(),
  html: z.string().meta({
    description:
      'The HTML part as a JSON string, rendered from the template\'s sample variables. Show it only in a sandboxed `iframe srcdoc` (`sandbox=""`), never inline.',
  }),
  text: z.string().meta({ description: "The plain-text part." }),
});

export type SendTestEmailBody = z.output<typeof sendTestEmailSchema>;
export type EmailStatusResponse = z.output<typeof emailStatusResponseSchema>;
export type EmailMessageResponse = z.output<typeof emailMessageResponseSchema>;
export type EmailMessageDetailResponse = z.output<typeof emailMessageDetailResponseSchema>;
export type EmailMessagePageResponse = z.output<typeof emailMessagePageResponseSchema>;
export type EmailMessageIdResponse = z.output<typeof emailMessageIdResponseSchema>;
export type EmailTemplateListResponse = z.output<typeof emailTemplateListResponseSchema>;
export type EmailPreviewResponse = z.output<typeof emailPreviewResponseSchema>;
