import { SLUG_PATTERN, TEXT_LIMITS, validateSlug } from "@fluxkit/core";
import { z } from "zod";
import { timestampSchema, uuidSchema } from "../../../common/openapi-formats.js";
import { paginationQuerySchema } from "../../../common/pagination.js";
import { attributeDetailResponseSchema } from "../attributes/attributes.schemas.js";
import { codeSchema, positionSchema } from "../../shared/code-schemas.js";
import { i18nTextSchema } from "../../shared/i18n-validation.js";

// Schemas check structure and static limits. Locale rules and rules that depend on other rows run in the
// service with the core functions; see ProductTypesService.

export const attributeLevelSchema = z.enum(["product", "variant"]);

/**
 * Slug of the storefront shop page linked next to the option pickers (a size guide). The API cannot know the storefront's
 * pages, so only the slug shape is checked; the storefront ignores a page it does not have or has switched off.
 */
const optionGuidePageSchema = z
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

/** `POST /admin/product-types`. `optionGuidePage` omitted or `null`: no guide page. */
export const createProductTypeSchema = z.strictObject({
  code: codeSchema,
  name: i18nTextSchema,
  requiresShipping: z.boolean().optional(),
  optionGuidePage: optionGuidePageSchema.nullable().optional(),
});

/** `PATCH /admin/product-types/:id`. `code` is not accepted (400 unknown_field); `optionGuidePage: null` clears it. */
export const updateProductTypeSchema = z.strictObject({
  name: i18nTextSchema.optional(),
  requiresShipping: z.boolean().optional(),
  optionGuidePage: optionGuidePageSchema.nullable().optional(),
});

export const listProductTypesQuerySchema = paginationQuerySchema;

/** `PUT /admin/product-types/:id/attributes/:attributeId`: creates the assignment or replaces it. */
export const putProductTypeAttributeSchema = z.strictObject({
  level: attributeLevelSchema,
  isRequired: z.boolean().optional(),
  position: positionSchema.optional(),
});

/** `PUT /admin/product-types/:id/options/:optionId`: creates the assignment or replaces it. */
export const putProductTypeOptionSchema = z.strictObject({
  position: positionSchema.optional(),
});

export const productTypeResponseSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  name: i18nTextSchema,
  requiresShipping: z.boolean(),
  optionGuidePage: z.string().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const productTypeAttributeResponseSchema = z.object({
  productTypeId: uuidSchema,
  attributeId: uuidSchema,
  attributeCode: z.string(),
  level: attributeLevelSchema,
  isRequired: z.boolean(),
  position: z.number().int(),
  createdAt: timestampSchema,
});

export const productTypeOptionResponseSchema = z.object({
  productTypeId: uuidSchema,
  optionId: uuidSchema,
  optionCode: z.string(),
  position: z.number().int(),
  createdAt: timestampSchema,
});

/**
 * An assignment in `GET /admin/product-types/:id` also carries the attribute definition with its options, exactly as
 * `GET /admin/attributes/:id` shows it, so an editor needs no request per attribute.
 */
export const productTypeDetailAttributeResponseSchema = productTypeAttributeResponseSchema.extend({
  attribute: attributeDetailResponseSchema,
});

/** `GET /admin/product-types/:id`: the type with its attribute and option assignments (position, then code). */
export const productTypeDetailResponseSchema = productTypeResponseSchema.extend({
  attributes: z.array(productTypeDetailAttributeResponseSchema),
  options: z.array(productTypeOptionResponseSchema),
});

export type CreateProductTypeBody = z.output<typeof createProductTypeSchema>;
export type UpdateProductTypeBody = z.output<typeof updateProductTypeSchema>;
export type PutProductTypeAttributeBody = z.output<typeof putProductTypeAttributeSchema>;
export type PutProductTypeOptionBody = z.output<typeof putProductTypeOptionSchema>;
export type ProductTypeResponse = z.output<typeof productTypeResponseSchema>;
export type ProductTypeDetailResponse = z.output<typeof productTypeDetailResponseSchema>;
export type ProductTypeAttributeResponse = z.output<typeof productTypeAttributeResponseSchema>;
export type ProductTypeOptionResponse = z.output<typeof productTypeOptionResponseSchema>;
