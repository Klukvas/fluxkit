import { CATALOG_LIMITS, TEXT_LIMITS } from "@fluxkit/core";
import { z } from "zod";
import { paginationQuerySchema } from "../../../common/pagination.js";
import { productVariantResponseSchema } from "../products/products.schemas.js";
import { isDatabaseSafeText, UNSAFE_TEXT_MESSAGE } from "../../shared/text.js";

// Schemas check structure and static limits. The SKU format, attribute values and option coverage are checked in
// the service with the core rules (they depend on the product and its product type).

const idSchema = z.guid().meta({ format: "uuid" });

/** Raw SKU as typed by the admin; the service trims, uppercases and validates it with core `validateSku`. */
const skuSchema = z.string().max(256).meta({
  description:
    "Trimmed and uppercased by the service, then checked against ^[A-Z0-9][A-Z0-9._-]{0,63}$. Globally unique.",
});

const barcodeSchema = z
  .string()
  .trim()
  .max(TEXT_LIMITS.barcode)
  .refine(isDatabaseSafeText, { error: UNSAFE_TEXT_MESSAGE })
  .meta({
    description:
      "Free text, at most 64 characters, no uniqueness check. An empty string clears it.",
  });

const attributeValuesSchema = z.record(z.string(), z.unknown()).meta({
  description:
    "Variant-level attribute values keyed by attribute code. Unknown codes and wrong types are rejected; required attributes are only enforced while the product is active.",
});

const trackInventorySchema = z.boolean().meta({
  description:
    "Whether stock is counted. false: always available, never reserved. Default true; false for a product type that does not ship.",
});
const allowBackorderSchema = z.boolean().meta({
  description: "Whether the variant can be reserved beyond the stock on hand. Default false.",
});

/**
 * `POST /admin/products/:id/variants` (draft products only). `optionValueIds` holds one value of every option the
 * product uses, chosen among the values the product selected (an empty list for a product without options).
 * `sku` is proposed from the slug and the value codes when omitted. A new variant is never the default one.
 */
export const createVariantSchema = z.strictObject({
  optionValueIds: z.array(idSchema).max(CATALOG_LIMITS.maxOptionsPerProduct),
  sku: skuSchema.optional(),
  barcode: barcodeSchema.nullable().optional(),
  attributes: attributeValuesSchema.optional(),
  isActive: z.boolean().optional(),
  trackInventory: trackInventorySchema.optional(),
  allowBackorder: allowBackorderSchema.optional(),
});

/**
 * `PATCH /admin/products/:id/variants/:variantId`. The option values of a variant cannot change (delete and create
 * a new variant on a draft). `isDefault: true` makes this variant the default and unsets the previous one in the
 * same transaction; the default cannot be unset directly.
 */
export const updateVariantSchema = z.strictObject({
  sku: skuSchema.optional(),
  barcode: barcodeSchema.nullable().optional(),
  attributes: attributeValuesSchema.optional(),
  isActive: z.boolean().optional(),
  trackInventory: trackInventorySchema.optional(),
  allowBackorder: allowBackorderSchema.optional(),
  position: z.number().int().min(0).max(1_000_000).optional(),
  isDefault: z.boolean().optional(),
});

export const listVariantsQuerySchema = paginationQuerySchema;

export const variantResponseSchema = productVariantResponseSchema;

/** `POST .../variants/generate`: `skipped` counts the combinations that already had a variant. */
export const generateVariantsResponseSchema = z.object({
  created: z.number().int().min(0),
  skipped: z.number().int().min(0),
  variants: z.array(variantResponseSchema),
});

export type CreateVariantBody = z.output<typeof createVariantSchema>;
export type UpdateVariantBody = z.output<typeof updateVariantSchema>;
export type ListVariantsQuery = z.output<typeof listVariantsQuerySchema>;
export type VariantResponse = z.output<typeof variantResponseSchema>;
export type GenerateVariantsResponse = z.output<typeof generateVariantsResponseSchema>;
