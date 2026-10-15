import { CATALOG_LIMITS } from "@fluxkit/core";
import { z } from "zod";

const idSchema = z.guid().meta({ format: "uuid" });

/**
 * API-level caps that bound one request. The product limits (3 options, 30 values per option) are enforced by core
 * so that the answer names the rule; these only stop absurd payloads before core sees them.
 */
const MAX_OPTIONS_IN_REQUEST = 10 * CATALOG_LIMITS.maxOptionsPerProduct;
const MAX_VALUES_IN_REQUEST = 10 * CATALOG_LIMITS.maxValuesPerProductOption;

/**
 * `PUT /admin/products/:id/options`: the whole selection. The order of the list is the display order of the options
 * and of each `valueIds` list. An empty `options` list gives the product no options (one default variant).
 */
export const putProductOptionsSchema = z.strictObject({
  options: z
    .array(
      z.strictObject({
        optionId: idSchema,
        valueIds: z.array(idSchema).max(MAX_VALUES_IN_REQUEST),
      }),
    )
    .max(MAX_OPTIONS_IN_REQUEST),
});

/** `POST /admin/products/:id/options/:optionId/values`. */
export const addProductOptionValueSchema = z.strictObject({
  valueId: idSchema,
});

export type PutProductOptionsBody = z.output<typeof putProductOptionsSchema>;
export type AddProductOptionValueBody = z.output<typeof addProductOptionValueSchema>;
