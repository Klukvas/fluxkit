import { MAX_AMOUNT, MAX_CART_LINES, MAX_LINE_QUANTITY } from "@fluxkit/core";
import { z } from "zod";
import { uuidSchema } from "../common/openapi-formats.js";

// Store cart API shapes (docs/api/cart.md, ADR 0015). Request schemas check structure only: whether a quantity is
// acceptable is decided by the core cart rules (`addLine`, `setLineQuantity`), so the rule and its error code exist once.

const localeQuery = z
  .string()
  .min(1)
  .max(16)
  .optional()
  .meta({ description: "One of the configured locales. Missing means the default locale." });

export const cartQuerySchema = z.strictObject({ locale: localeQuery });

/**
 * The quantity is documented as an integer from 1 to 999 but accepted as any JSON value: a string, a fraction, 0 or a
 * negative number all reach the core rule, which answers `invalid_quantity` (400) for every one of them.
 */
const quantityField = z.unknown().meta({
  type: "integer",
  minimum: 1,
  maximum: MAX_LINE_QUANTITY,
  description: `Whole number from 1 to ${String(MAX_LINE_QUANTITY)}.`,
});

export const addCartItemSchema = z.strictObject({
  variantId: z.guid().meta({ description: "The variant to buy (never the product)." }),
  quantity: quantityField,
});

export const setCartItemQuantitySchema = z.strictObject({ quantity: quantityField });

export type CartQuery = z.output<typeof cartQuerySchema>;
export type AddCartItemBody = z.output<typeof addCartItemSchema>;
export type SetCartItemQuantityBody = z.output<typeof setCartItemQuantitySchema>;

/** Money is a JSON integer in minor units (0 to MAX_AMOUNT, so it is exact in every JSON parser). */
const amountSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_AMOUNT)
  .meta({ description: "Minor units of the shop currency (for example kopiykas)." });

const moneySchema = z.object({ amount: amountSchema, currency: z.string() });

const availabilitySchema = z.enum(["in_stock", "low_stock", "out_of_stock"]);

export const cartLineNoticeSchema = z.discriminatedUnion("code", [
  z.object({
    code: z.literal("price_changed"),
    previousAmount: moneySchema.meta({
      description:
        "The unit price the shopper last saw (`POST /store/cart/acknowledge` accepts the current one).",
    }),
  }),
  z.object({ code: z.literal("unavailable") }),
  z.object({ code: z.literal("out_of_stock") }),
]);

export const cartLineSchema = z.object({
  variantId: uuidSchema,
  productSlug: z.string(),
  sku: z.string(),
  title: z.string(),
  variantTitle: z.string().nullable(),
  optionValues: z.array(z.object({ option: z.string(), value: z.string() })),
  image: z.object({ url: z.string(), alt: z.string().nullable() }).nullable(),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
  unitPrice: moneySchema.nullable().meta({ description: "`null` on an unavailable line." }),
  compareAtAmount: amountSchema.nullable().meta({
    description: "Regular price per unit in the unit price currency, when the variant is on sale.",
  }),
  lineTotal: moneySchema.nullable().meta({ description: "`null` on an unavailable line." }),
  availability: availabilitySchema.meta({
    description: "`out_of_stock` on an unavailable line. Never a quantity.",
  }),
  notices: z.array(cartLineNoticeSchema),
});

/** `quantity_capped` and `lines_dropped` come from the merge at sign-in; they are reported once, in `cartNotices`. */
export const cartNoticeSchema = z.object({
  code: z.enum(["quantity_capped", "lines_dropped"]),
});

export const cartSchema = z.object({
  lines: z.array(cartLineSchema).max(MAX_CART_LINES),
  subtotal: moneySchema.meta({
    description: "Sum of the line totals of the available lines (unavailable lines are left out).",
  }),
  total: moneySchema.meta({
    description: "Equal to `subtotal` until shipping, discount or tax adjustments exist.",
  }),
  itemCount: z.number().int().min(0),
  purchasable: z.boolean().meta({
    description: "At least one line and no unavailable line.",
  }),
  notices: z.array(cartNoticeSchema),
});

export type CartLineResponse = z.output<typeof cartLineSchema>;
export type CartResponse = z.output<typeof cartSchema>;
export type CartNoticeResponse = z.output<typeof cartNoticeSchema>;
