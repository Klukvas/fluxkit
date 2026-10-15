import { SLUG_PATTERN, TEXT_LIMITS, validateSlug } from "@fluxkit/core";
import { z } from "zod";
import { timestampSchema, uuidSchema } from "../../../common/openapi-formats.js";
import { paginationQuerySchema } from "../../../common/pagination.js";
import { positionSchema } from "../../shared/code-schemas.js";
import { i18nTextSchema } from "../../shared/i18n-validation.js";

// Schemas check structure and static limits. Locale rules run in the service with the core i18n functions; tree
// rules (existence of the parent, depth, cycles) run in the service with the core category-tree functions.

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

const parentIdSchema = z.guid().meta({ format: "uuid" });

/**
 * `POST /admin/categories`. `slug` is generated from the default-locale name when omitted. `position` is the index
 * among the siblings (0 = first); omitted means last.
 */
export const createCategorySchema = z.strictObject({
  name: i18nTextSchema,
  description: i18nTextSchema.optional(),
  slug: slugSchema.optional(),
  parentId: parentIdSchema.nullable().optional(),
  position: positionSchema.optional(),
  isActive: z.boolean().optional(),
});

/**
 * `PATCH /admin/categories/:id`. A text map replaces the whole map; `null` clears the description.
 * `parentId` and `position` are NOT accepted here (unknown fields are rejected): only `move` changes the tree.
 */
export const updateCategorySchema = z.strictObject({
  name: i18nTextSchema.optional(),
  description: i18nTextSchema.nullable().optional(),
  slug: slugSchema.optional(),
  isActive: z.boolean().optional(),
});

/** `POST /admin/categories/:id/move`. `parentId: null` moves to the root level; omitted `position` means last. */
export const moveCategorySchema = z.strictObject({
  parentId: parentIdSchema.nullable(),
  position: positionSchema.optional(),
});

export const listCategoriesQuerySchema = paginationQuerySchema.extend({
  parentId: parentIdSchema.optional(),
});

export const categoryResponseSchema = z.object({
  id: uuidSchema,
  parentId: uuidSchema.nullable(),
  slug: z.string(),
  name: i18nTextSchema,
  description: i18nTextSchema.nullable(),
  position: z.number().int(),
  isActive: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type CreateCategoryBody = z.output<typeof createCategorySchema>;
export type UpdateCategoryBody = z.output<typeof updateCategorySchema>;
export type MoveCategoryBody = z.output<typeof moveCategorySchema>;
export type ListCategoriesQuery = z.output<typeof listCategoriesQuerySchema>;
export type CategoryResponse = z.output<typeof categoryResponseSchema>;
