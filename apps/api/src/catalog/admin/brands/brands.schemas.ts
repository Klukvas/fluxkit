import { SLUG_PATTERN, TEXT_LIMITS, validateSlug } from "@fluxkit/core";
import { z } from "zod";
import { timestampSchema, uuidSchema } from "../../../common/openapi-formats.js";
import { paginationQuerySchema } from "../../../common/pagination.js";
import { i18nTextSchema } from "../../shared/i18n-validation.js";

// Schemas check structure and static limits. Rules that depend on configuration (allowed locales, default
// locale) run in the service with the core i18n functions; see BrandsService.

const slugSchema = z
  .string()
  // Refinements are invisible in the JSON schema, so the documented constraints are repeated as metadata.
  .meta({ pattern: SLUG_PATTERN.source, maxLength: TEXT_LIMITS.slug })
  .superRefine((slug, context) => {
    const result = validateSlug(slug);
    if (!result.ok) {
      context.addIssue({
        code: "custom",
        message: `Invalid slug: ${result.reason}.`,
        params: { code: result.reason },
      });
    }
  });

const logoUrlSchema = z
  .url({ protocol: /^https?$/, error: "Must be an http or https URL." })
  .max(TEXT_LIMITS.url)
  // A NUL character passes URL parsing but Postgres rejects it in text columns (would be an HTTP 500).
  .refine((url) => !url.includes("\u0000"), { error: "Must not contain NUL characters." })
  .meta({ pattern: "^https?://" });

/** `POST /admin/brands`. `slug` is generated from the default-locale name when omitted. */
export const createBrandSchema = z.strictObject({
  name: i18nTextSchema,
  description: i18nTextSchema.optional(),
  logoUrl: logoUrlSchema.optional(),
  slug: slugSchema.optional(),
});

/** `PATCH /admin/brands/:id`. A text map replaces the whole map; `null` clears an optional field. */
export const updateBrandSchema = z.strictObject({
  name: i18nTextSchema.optional(),
  description: i18nTextSchema.nullable().optional(),
  logoUrl: logoUrlSchema.nullable().optional(),
  slug: slugSchema.optional(),
});

export const listBrandsQuerySchema = paginationQuerySchema;

export const brandResponseSchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  name: i18nTextSchema,
  description: i18nTextSchema.nullable(),
  logoUrl: z.string().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type CreateBrandBody = z.output<typeof createBrandSchema>;
export type UpdateBrandBody = z.output<typeof updateBrandSchema>;
export type BrandResponse = z.output<typeof brandResponseSchema>;
