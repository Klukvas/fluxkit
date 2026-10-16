import { CATALOG_LIMITS, MAX_AMOUNT, SLUG_PATTERN, type PublicAttributeValue } from "@fluxkit/core";
import { z } from "zod";
import { timestampSchema, uuidSchema } from "../../common/openapi-formats.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";

// Store API (public, read-only) shapes. Query schemas check structure; the locale is checked against the
// configured list in the service because it is configuration, not a constant.

export const STORE_DEFAULT_PAGE_SIZE = 24;

const integerString = z.string().regex(/^\d{1,9}$/, "must be a non-negative integer");

const localeQuery = z
  .string()
  .min(1)
  .max(16)
  .optional()
  .meta({ description: "One of the configured locales. Missing means the default locale." });

const paginationQuery = {
  limit: integerString
    .transform(Number)
    .pipe(z.number().int().min(1).max(CATALOG_LIMITS.maxPageSize))
    .default(STORE_DEFAULT_PAGE_SIZE),
  offset: integerString
    .transform(Number)
    .pipe(z.number().int().min(0).max(CATALOG_LIMITS.maxOffset))
    .default(0),
};

/** A filter slug must look like a stored slug: text with NUL or other odd characters never reaches Postgres. */
const slugQuery = z
  .string()
  .min(1)
  .max(160)
  .regex(SLUG_PATTERN, "must be a slug: lowercase letters, digits and single hyphens");

const slugPathLength = z.string().min(1).max(160);

/**
 * Validates the `:slug` path parameter: a too long one is a 400. A malformed one cannot exist as a product, so the
 * service answers 404 for it without a query (`isStoreSlug`).
 */
export function slugParam(): ZodValidationPipe<typeof slugPathLength> {
  return new ZodValidationPipe(slugPathLength, "slug");
}

export function isStoreSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

export const storeCategoriesQuerySchema = z.strictObject({ locale: localeQuery });

export const storeProductsQuerySchema = z.strictObject({
  locale: localeQuery,
  ...paginationQuery,
  category: slugQuery
    .optional()
    .meta({ description: "Category slug: the category and all its active descendants." }),
  brand: slugQuery.optional().meta({ description: "Brand slug." }),
});

export const storeProductQuerySchema = z.strictObject({ locale: localeQuery });

export type StoreCategoriesQuery = z.output<typeof storeCategoriesQuerySchema>;
export type StoreProductsQuery = z.output<typeof storeProductsQuerySchema>;
export type StoreProductQuery = z.output<typeof storeProductQuerySchema>;

const nullableText = z.string().nullable();

export interface StoreCategoryNode {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  children: StoreCategoryNode[];
}

const categoryNodeFields = {
  id: uuidSchema,
  slug: z.string(),
  name: z.string(),
  description: nullableText,
};

/** The tree is at most `maxCategoryDepth` levels deep, so the document spells the levels out instead of using a recursive schema. */
function categoryNodeSchema(levels: number): z.ZodType {
  return z.object({
    ...categoryNodeFields,
    children: levels <= 1 ? z.array(z.never()) : z.array(categoryNodeSchema(levels - 1)),
  });
}

export const storeCategoryTreeSchema = z.object({
  items: z.array(categoryNodeSchema(CATALOG_LIMITS.maxCategoryDepth)),
});

const brandSchema = z.object({ slug: z.string(), name: z.string() });

/** Money is a JSON integer in minor units (0 to MAX_AMOUNT, so it is exact in every JSON parser). */
const amountSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_AMOUNT)
  .meta({ description: "Minor units of the shop currency (for example kopiykas)." });

const availabilitySchema = z.enum(["in_stock", "low_stock", "out_of_stock"]);

const variantPriceSchema = z.object({
  amount: amountSchema,
  currency: z.string().meta({ description: "Always the shop currency." }),
  compareAtAmount: amountSchema.nullable(),
});

const priceRangeSchema = z.object({
  from: amountSchema,
  to: amountSchema,
  currency: z.string().meta({ description: "Always the shop currency." }),
});

export const storeConfigSchema = z.object({
  currency: z.string(),
  currencyExponent: z.number().int().min(0),
  pricesIncludeTax: z.boolean(),
  defaultLocale: z.string(),
  locales: z.array(z.string()),
});

export type StoreConfig = z.output<typeof storeConfigSchema>;

export const storeProductListItemSchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  title: z.string(),
  brand: brandSchema.nullable(),
  image: z.object({ url: z.string(), alt: nullableText }).nullable(),
  publishedAt: timestampSchema,
  price: priceRangeSchema,
  availability: availabilitySchema,
});

const publicOptionValueSchema = z.object({ code: z.string(), label: z.string() });

const publicAttributeValueSchema = z.union([
  z.string(),
  z.boolean(),
  z.object({ value: z.number(), unit: nullableText }),
  publicOptionValueSchema,
  z.array(publicOptionValueSchema),
]);

const attributesSchema = z.record(z.string(), publicAttributeValueSchema);

export const storeAttributeDefinitionSchema = z.object({
  code: z.string(),
  name: z.string(),
  inputType: z.enum(["text", "number", "boolean", "select", "multiselect", "date"]),
  isLocalized: z.boolean(),
  unit: nullableText,
  isFilterable: z.boolean(),
  isComparable: z.boolean(),
  isSortable: z.boolean(),
  options: z.array(publicOptionValueSchema),
});

export const storeProductDetailSchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  title: z.string(),
  description: nullableText,
  brand: brandSchema.nullable(),
  publishedAt: timestampSchema,
  categories: z.array(z.object({ id: uuidSchema, slug: z.string(), name: z.string() })),
  attributes: attributesSchema,
  attributeDefinitions: z.array(storeAttributeDefinitionSchema),
  options: z.array(
    z.object({
      id: uuidSchema,
      code: z.string(),
      name: z.string(),
      values: z.array(z.object({ id: uuidSchema, code: z.string(), name: z.string() })),
    }),
  ),
  variants: z.array(
    z.object({
      id: uuidSchema,
      sku: z.string(),
      optionValues: z.array(z.object({ optionCode: z.string(), valueCode: z.string() })),
      attributes: attributesSchema,
      price: variantPriceSchema,
      availability: availabilitySchema,
    }),
  ),
  price: priceRangeSchema,
  availability: availabilitySchema,
  media: z.array(
    z.object({ url: z.string(), alt: nullableText, optionValueId: uuidSchema.nullable() }),
  ),
});

export type StoreProductListItem = z.output<typeof storeProductListItemSchema>;

/** Attribute values as core emits them (readonly); the schemas above document the same shape for OpenAPI. */
export type StoreAttributes = Readonly<Record<string, PublicAttributeValue>>;
type StoreProductDetailShape = z.output<typeof storeProductDetailSchema>;
export type StoreProductDetail = Omit<StoreProductDetailShape, "attributes" | "variants"> & {
  attributes: StoreAttributes;
  variants: (Omit<StoreProductDetailShape["variants"][number], "attributes"> & {
    attributes: StoreAttributes;
  })[];
};
