import { CURRENCY_CODES, isSupportedCurrency, MAX_AMOUNT } from "@fluxkit/core";
import { z } from "zod";
import { timestampSchema, uuidSchema } from "../../../common/openapi-formats.js";
import { ZodValidationPipe } from "../../../common/zod-validation.pipe.js";

// Schemas check structure only. Range, integer, sign and the compare-at rule are decided by core `validatePrice` in
// the service, so the error codes are the core reasons (`amount_out_of_range`, `compare_at_not_greater`, ...).

/**
 * API-level cap on one bulk call. A product has at most `CATALOG_LIMITS.maxVariantsPerProduct` (250) variants, so 500
 * items price every variant in two currencies; the cap bounds untrusted input, not the catalog.
 */
export const MAX_BULK_PRICE_ITEMS = 500;

const idSchema = z.guid().meta({ format: "uuid" });

const amountSchema = z.number().meta({
  description: `Integer in minor units (for example kopiykas), 0 to ${MAX_AMOUNT}. Never a decimal.`,
});
const compareAtAmountSchema = z.number().nullable().meta({
  description:
    "Old price in minor units, an integer strictly greater than amount. null or absent clears it.",
});

const currencySchema = z.string().meta({
  description: `Upper-case ISO 4217 code, exactly as listed: ${CURRENCY_CODES.join(", ")}.`,
});

/** The `:currency` path parameter: upper case and in core's table, anything else is a 400 (never a 404 guess). */
export const currencyParamSchema = z.string().superRefine((value, context) => {
  if (!isSupportedCurrency(value)) {
    context.addIssue({
      code: "custom",
      message: `Must be one of ${CURRENCY_CODES.join(", ")}.`,
      params: { code: "unsupported_currency" },
    });
  }
});

export function currencyParam(): ZodValidationPipe<typeof currencyParamSchema> {
  return new ZodValidationPipe(currencyParamSchema, "currency");
}

/** `PUT .../variants/:variantId/prices/:currency`: creates the price or replaces it entirely. */
export const putPriceSchema = z.strictObject({
  amount: amountSchema,
  compareAtAmount: compareAtAmountSchema.optional(),
});

/** One entry of the bulk body; `currency` is validated against core's table in the service (indexed error path). */
export const bulkPriceItemSchema = z.strictObject({
  variantId: idSchema,
  currency: currencySchema,
  amount: amountSchema,
  compareAtAmount: compareAtAmountSchema.optional(),
});

/** `PUT /admin/products/:id/prices`: all items are written in one transaction, or none. */
export const putProductPricesSchema = z.strictObject({
  items: z.array(bulkPriceItemSchema).min(1).max(MAX_BULK_PRICE_ITEMS),
});

export const priceResponseSchema = z.object({
  id: uuidSchema,
  variantId: uuidSchema,
  currency: z.string(),
  amount: z.number().int().min(0).max(MAX_AMOUNT),
  compareAtAmount: z.number().int().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const priceListResponseSchema = z.object({ items: z.array(priceResponseSchema) });

export type PutPriceBody = z.output<typeof putPriceSchema>;
export type BulkPriceItem = z.output<typeof bulkPriceItemSchema>;
export type PutProductPricesBody = z.output<typeof putProductPricesSchema>;
export type PriceResponse = z.output<typeof priceResponseSchema>;
export type PriceListResponse = z.output<typeof priceListResponseSchema>;
