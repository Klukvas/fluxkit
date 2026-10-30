import { ADMIN_AUDIT_ACTIONS, ADMIN_AUDIT_TARGET_KINDS, CATALOG_LIMITS } from "@fluxkit/core";
import { z } from "zod";
import { timestampSchema, uuidSchema } from "../../common/openapi-formats.js";

export const AUDIT_EVENTS_DEFAULT_PAGE_SIZE = 50;
const MIN_INSTANT = new Date("2000-01-01T00:00:00.000Z");
const MAX_INSTANT = new Date("2200-01-01T00:00:00.000Z");

const integerString = z.string().regex(/^\d{1,9}$/, "must be a non-negative integer");

const instantSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .refine(
    (value) =>
      !Number.isNaN(value.getTime()) &&
      value.getTime() >= MIN_INSTANT.getTime() &&
      value.getTime() < MAX_INSTANT.getTime(),
    { message: "must be between 2000-01-01 and 2200-01-01", params: { code: "out_of_range" } },
  );

/**
 * `GET /admin/audit-events`. Strict: a misspelt filter is a `400`, never a silent "all events". `from` is inclusive,
 * `to` exclusive. Filters combine (AND).
 */
export const listAuditEventsQuerySchema = z
  .strictObject({
    limit: integerString
      .transform(Number)
      .pipe(z.number().int().min(1).max(CATALOG_LIMITS.maxPageSize))
      .default(AUDIT_EVENTS_DEFAULT_PAGE_SIZE),
    offset: integerString
      .transform(Number)
      .pipe(z.number().int().min(0).max(CATALOG_LIMITS.maxOffset))
      .default(0),
    action: z.enum(ADMIN_AUDIT_ACTIONS).optional(),
    adminUserId: z.guid().meta({ format: "uuid" }).optional(),
    targetKind: z.enum(ADMIN_AUDIT_TARGET_KINDS).optional(),
    targetId: z.guid().meta({ format: "uuid" }).optional(),
    from: instantSchema.optional(),
    to: instantSchema.optional(),
  })
  .superRefine((query, context) => {
    if (
      query.from !== undefined &&
      query.to !== undefined &&
      query.from.getTime() > query.to.getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "must not be before from",
        params: { code: "before_from" },
      });
    }
  });

export type ListAuditEventsQuery = z.output<typeof listAuditEventsQuerySchema>;

export const auditEventSchema = z.object({
  id: uuidSchema,
  createdAt: timestampSchema,
  adminUserId: uuidSchema.nullable().meta({
    description:
      "The acting admin; null once that admin user was deleted, and for `pnpm admin:create` (no acting admin; `detail.source` is `cli`).",
  }),
  action: z.enum(ADMIN_AUDIT_ACTIONS),
  targetKind: z.enum(ADMIN_AUDIT_TARGET_KINDS),
  targetId: uuidSchema,
  detail: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
    .meta({ description: "Codes, counts and flags only; never personal data." }),
});

export type AuditEventView = z.output<typeof auditEventSchema>;
