import { COUNTRY_CODE_PATTERN, SHIPPING_LIMITS, SHIPPING_METHOD_KINDS } from "@fluxkit/core";
import { z } from "zod";
import { codeSchema, positionSchema } from "../../catalog/shared/code-schemas.js";
import { i18nTextSchema } from "../../catalog/shared/i18n-validation.js";
import { isDatabaseSafeText, UNSAFE_TEXT_MESSAGE } from "../../catalog/shared/text.js";
import { timestampSchema, uuidSchema } from "../../common/openapi-formats.js";
import { paginationQuerySchema } from "../../common/pagination.js";

// Schemas check structure and static limits. Rules that depend on configuration (locales, the shop currency, the
// enabled providers) and the pricing rules of core run in ShippingMethodsService, which answers with the core reasons.

const kindSchema = z.enum(SHIPPING_METHOD_KINDS);

const providerServiceSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isDatabaseSafeText, { error: UNSAFE_TEXT_MESSAGE });

const countryCodesSchema = z
  .array(
    z
      .string()
      .regex(COUNTRY_CODE_PATTERN, "Two upper-case letters (ISO 3166-1 alpha-2), for example UA."),
  )
  .min(1)
  .max(SHIPPING_LIMITS.maxCountriesPerMethod)
  .superRefine((codes, context) => {
    const seen = new Set<string>();
    codes.forEach((code, index) => {
      if (seen.has(code)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "Each country appears once.",
          params: { code: "duplicate_country" },
        });
      }
      seen.add(code);
    });
  });

/**
 * The request shape of `pricing`: any object here; the exact rules (type, fields, integer minor units, tiers) are core's
 * `validateShippingPricing`, whose reasons the answer carries. The four shapes are in `pricingSchema` below. A custom check
 * and not `z.record`: zod rebuilds a record and silently drops an own `__proto__` key, which core must see to refuse it.
 */
const pricingInputSchema = z
  .custom<Record<string, unknown>>(
    (value) => typeof value === "object" && value !== null && !Array.isArray(value),
    { message: "Must be a JSON object.", params: { code: "invalid_type" } },
  )
  .meta({
    type: "object",
    additionalProperties: true,
    description:
      "One of `{type: 'flat', amount}`, `{type: 'free_over', amount, freeFrom}`, `{type: 'tiers', tiers: [{fromSubtotal, amount}]}` or `{type: 'carrier_on_delivery'}`. Every amount is an integer in minor units of the shop currency. Tiers start at `fromSubtotal` 0 and strictly ascend.",
    examples: [
      { type: "flat", amount: 8000 },
      { type: "free_over", amount: 8000, freeFrom: 200000 },
      {
        type: "tiers",
        tiers: [
          { fromSubtotal: 0, amount: 12000 },
          { fromSubtotal: 100000, amount: 6000 },
        ],
      },
      { type: "carrier_on_delivery" },
    ],
  });

/** `POST /admin/shipping/methods`. The currency is the shop currency; the method is inactive unless `isActive` is true. */
export const createShippingMethodSchema = z.strictObject({
  code: codeSchema,
  title: i18nTextSchema,
  description: i18nTextSchema.optional(),
  kind: kindSchema,
  providerCode: codeSchema.nullable().optional(),
  providerService: providerServiceSchema.nullable().optional(),
  pricing: pricingInputSchema,
  countryCodes: countryCodesSchema,
  isActive: z.boolean().optional(),
  position: positionSchema.optional(),
});

/** `PATCH /admin/shipping/methods/:id`. The code never changes. A text map replaces the whole map; `null` clears an optional field. */
export const updateShippingMethodSchema = z.strictObject({
  title: i18nTextSchema.optional(),
  description: i18nTextSchema.nullable().optional(),
  kind: kindSchema.optional(),
  providerCode: codeSchema.nullable().optional(),
  providerService: providerServiceSchema.nullable().optional(),
  pricing: pricingInputSchema.optional(),
  countryCodes: countryCodesSchema.optional(),
  isActive: z.boolean().optional(),
  position: positionSchema.optional(),
});

export const listShippingMethodsQuerySchema = paginationQuerySchema;

const amountSchema = z.number().int().min(0);

/** The four stored shapes of `pricing`, for the documentation of responses. */
const pricingSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("flat"), amount: amountSchema }),
  z.object({ type: z.literal("free_over"), amount: amountSchema, freeFrom: amountSchema }),
  z.object({
    type: z.literal("tiers"),
    tiers: z.array(z.object({ fromSubtotal: amountSchema, amount: amountSchema })),
  }),
  z.object({ type: z.literal("carrier_on_delivery") }),
]);

export const shippingMethodResponseSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  title: i18nTextSchema,
  description: i18nTextSchema.nullable(),
  kind: kindSchema,
  providerCode: z.string().nullable(),
  providerService: z.string().nullable(),
  pricing: pricingSchema,
  currency: z.string().meta({ description: "The currency of every amount in `pricing`." }),
  countryCodes: z.array(z.string()),
  isActive: z.boolean(),
  position: z.number().int(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type CreateShippingMethodBody = z.output<typeof createShippingMethodSchema>;
export type UpdateShippingMethodBody = z.output<typeof updateShippingMethodSchema>;
export type ShippingMethodResponse = z.output<typeof shippingMethodResponseSchema>;
