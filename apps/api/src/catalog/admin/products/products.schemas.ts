import { SLUG_PATTERN, TEXT_LIMITS, validateSlug } from "@fluxkit/core";
import { z } from "zod";
import { timestampSchema, uuidSchema } from "../../../common/openapi-formats.js";
import { paginationQuerySchema } from "../../../common/pagination.js";
import { positionSchema } from "../../shared/code-schemas.js";
import { i18nTextSchema } from "../../shared/i18n-validation.js";
import { isDatabaseSafeText, UNSAFE_TEXT_MESSAGE } from "../../shared/text.js";

// Schemas check structure and static limits. Locale rules run in the service with the core i18n functions;
// attribute values are validated against the product type with the core attribute rules (draft or publish mode).

/** API-level caps on one replace call (ADR 0006 section 9 has no limit for these; they bound untrusted input). */
export const MAX_CATEGORIES_PER_PRODUCT = 100;
export const MAX_MEDIA_PER_PRODUCT = 100;

export const PRODUCT_STATUSES = ["draft", "active", "archived"] as const;
export const productStatusSchema = z.enum(PRODUCT_STATUSES);

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

const idSchema = z.guid().meta({ format: "uuid" });

const mediaUrlSchema = z
  .url({ protocol: /^https?$/, error: "Must be an http or https URL." })
  .max(TEXT_LIMITS.url)
  .refine(isDatabaseSafeText, { error: UNSAFE_TEXT_MESSAGE })
  .meta({ pattern: "^https?://" });

const attributeValuesSchema = z.record(z.string(), z.unknown()).meta({
  description:
    "Product-level attribute values keyed by attribute code (ADR 0006 section 4). Validated against the product type: unknown codes and wrong types are rejected; required attributes are only enforced on publish.",
});

/**
 * `POST /admin/products`. Creates a draft and its single default variant. `slug` is generated from the
 * default-locale title when omitted.
 */
export const createProductSchema = z.strictObject({
  productTypeId: idSchema,
  title: i18nTextSchema,
  description: i18nTextSchema.optional(),
  brandId: idSchema.nullable().optional(),
  slug: slugSchema.optional(),
  attributes: attributeValuesSchema.optional(),
});

/**
 * `PATCH /admin/products/:id`. A text map or `attributes` replaces the whole value; `null` clears an optional
 * field. `status` is not accepted (use the lifecycle routes). `productTypeId` is accepted only to answer 409
 * `product_type_immutable` when it differs from the stored value.
 */
export const updateProductSchema = z.strictObject({
  productTypeId: idSchema.optional(),
  title: i18nTextSchema.optional(),
  description: i18nTextSchema.nullable().optional(),
  brandId: idSchema.nullable().optional(),
  slug: slugSchema.optional(),
  attributes: attributeValuesSchema.optional(),
});

/**
 * What a search text may contain: the characters of a slug and of a SKU (`a-z`, `A-Z`, `0-9`, `.`, `_`, `-`). Anything
 * else cannot start a slug or equal a SKU, so it is a 400 instead of a silent empty result, and LIKE wildcards never
 * reach the database (the repository escapes `_` anyway).
 */
const SEARCH_TEXT_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * `GET /admin/products`: `q` is the start of a slug or an exact SKU of any variant (never a title or a substring: text
 * search belongs to the search index, AGENTS.md section 2.3). Trimmed; case does not matter.
 */
export const listProductsQuerySchema = paginationQuerySchema.extend({
  status: productStatusSchema.optional(),
  categoryId: idSchema.optional(),
  brandId: idSchema.optional(),
  q: z
    .string()
    .trim()
    .min(1)
    .max(TEXT_LIMITS.slug)
    .regex(SEARCH_TEXT_PATTERN, "must contain only letters, digits, dots, underscores and hyphens")
    .optional(),
});

/**
 * `PUT /admin/products/:id/categories`: replaces the whole set. `position` defaults to the index in the list.
 * `primaryCategoryId` must be in the list; when it is omitted or null the current primary stays primary if it is
 * still assigned, otherwise the assignment with the lowest position becomes primary.
 */
export const putProductCategoriesSchema = z.strictObject({
  categories: z
    .array(z.strictObject({ categoryId: idSchema, position: positionSchema.optional() }))
    .max(MAX_CATEGORIES_PER_PRODUCT),
  primaryCategoryId: idSchema.nullable().optional(),
});

const mediaItemSchema = z
  .strictObject({
    url: mediaUrlSchema,
    alt: i18nTextSchema.nullable().optional(),
    position: positionSchema.optional(),
    optionId: idSchema.nullable().optional(),
    optionValueId: idSchema.nullable().optional(),
  })
  .superRefine((item, context) => {
    const hasOption = item.optionId !== undefined && item.optionId !== null;
    const hasValue = item.optionValueId !== undefined && item.optionValueId !== null;
    if (hasOption !== hasValue) {
      context.addIssue({
        code: "custom",
        path: [hasOption ? "optionValueId" : "optionId"],
        message: "optionId and optionValueId must be given together or not at all.",
        params: { code: "option_pair_incomplete" },
      });
    }
  });

/** `PUT /admin/products/:id/media`: replaces the whole list. `position` defaults to the index in the list. */
export const putProductMediaSchema = z.strictObject({
  media: z.array(mediaItemSchema).max(MAX_MEDIA_PER_PRODUCT),
});

const attributeValuesResponseSchema = z.record(z.string(), z.unknown());

export const productResponseSchema = z.object({
  id: uuidSchema,
  productTypeId: uuidSchema,
  brandId: uuidSchema.nullable(),
  slug: z.string(),
  title: i18nTextSchema,
  description: i18nTextSchema.nullable(),
  status: productStatusSchema,
  attributes: attributeValuesResponseSchema,
  publishedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const productCategoryResponseSchema = z.object({
  categoryId: uuidSchema,
  isPrimary: z.boolean(),
  position: z.number().int(),
});

export const productMediaResponseSchema = z.object({
  id: uuidSchema,
  url: z.string(),
  alt: i18nTextSchema.nullable(),
  position: z.number().int(),
  optionId: uuidSchema.nullable(),
  optionValueId: uuidSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const variantOptionValueResponseSchema = z.object({
  optionId: uuidSchema,
  optionCode: z.string(),
  optionValueId: uuidSchema,
  valueCode: z.string(),
});

/** Read-only in this resource; variants are written by the variant routes. `optionSignature` is internal data. */
export const productVariantResponseSchema = z.object({
  id: uuidSchema,
  sku: z.string(),
  barcode: z.string().nullable(),
  title: i18nTextSchema.nullable(),
  optionSignature: z.string(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  trackInventory: z.boolean(),
  allowBackorder: z.boolean(),
  attributes: attributeValuesResponseSchema,
  position: z.number().int(),
  optionValues: z.array(variantOptionValueResponseSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const productOptionResponseSchema = z.object({
  optionId: uuidSchema,
  optionCode: z.string(),
  position: z.number().int(),
  values: z.array(
    z.object({
      optionValueId: uuidSchema,
      valueCode: z.string(),
      position: z.number().int(),
    }),
  ),
});

/** `GET /admin/products/:id`: the product with its categories, media, variants and options as stored. */
export const productDetailResponseSchema = productResponseSchema.extend({
  categories: z.array(productCategoryResponseSchema),
  media: z.array(productMediaResponseSchema),
  variants: z.array(productVariantResponseSchema),
  options: z.array(productOptionResponseSchema),
});

export type CreateProductBody = z.output<typeof createProductSchema>;
export type UpdateProductBody = z.output<typeof updateProductSchema>;
export type ListProductsQuery = z.output<typeof listProductsQuerySchema>;
export type PutProductCategoriesBody = z.output<typeof putProductCategoriesSchema>;
export type PutProductMediaBody = z.output<typeof putProductMediaSchema>;
export type ProductResponse = z.output<typeof productResponseSchema>;
export type ProductDetailResponse = z.output<typeof productDetailResponseSchema>;
export type ProductCategoryResponse = z.output<typeof productCategoryResponseSchema>;
export type ProductMediaResponse = z.output<typeof productMediaResponseSchema>;
export type ProductVariantResponse = z.output<typeof productVariantResponseSchema>;
export type ProductOptionResponse = z.output<typeof productOptionResponseSchema>;
