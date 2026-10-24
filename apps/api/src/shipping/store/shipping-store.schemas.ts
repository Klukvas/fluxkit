import {
  CARRIER_REFERENCE_PATTERN,
  CATALOG_LIMITS,
  COUNTRY_CODE_PATTERN,
  MAX_AMOUNT,
  PICKUP_POINT_KINDS,
  SHIPPING_LIMITS,
  SHIPPING_METHOD_KINDS,
  SHIPPING_PAYERS,
  SHIPPING_QUOTE_UNAVAILABLE_REASONS,
  type PickupPointKind,
} from "@fluxkit/core";
import { z } from "zod";

// Store shipping API shapes (docs/api/shipping.md, ADR 0029 decision 5). Every amount is computed by the server; nothing
// here is ever read back as a price.

const localeQuery = z
  .string()
  .min(1)
  .max(16)
  .optional()
  .meta({ description: "One of the configured locales. Missing means the default locale." });

const carrierRef = z
  .string()
  .regex(CARRIER_REFERENCE_PATTERN, "Not a carrier reference.")
  .meta({ description: "A carrier reference: ASCII letters, digits, `-` and `_`, 1 to 64." });

const integerString = z.string().regex(/^\d{1,9}$/, "must be a non-negative integer");

const codePoints = (value: string) => [...value].length;

export const shippingOptionsQuerySchema = z.strictObject({
  country: z.string().regex(COUNTRY_CODE_PATTERN, "Two upper-case letters.").optional().meta({
    description:
      "The destination country (ISO 3166-1 alpha-2) of the address the shopper entered. Kind `pickup_point` uses the country of `pickupPointRef` when it is given.",
  }),
  locale: localeQuery,
  cityRef: carrierRef.optional().meta({
    description: "A city of a provider (`GET .../cities`): asks for the carrier's estimate.",
  }),
  pickupPointRef: carrierRef.optional().meta({
    description:
      "A pickup point of a provider (`GET .../pickup-points`): its country and estimate.",
  }),
});

export type ShippingOptionsQuery = z.output<typeof shippingOptionsQuerySchema>;

const searchText = (min: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .refine((value) => codePoints(value) >= min, {
      params: { code: "too_short" },
      message: `At least ${String(min)} characters.`,
    })
    .refine((value) => codePoints(value) <= SHIPPING_LIMITS.lookupQueryMaxLength, {
      params: { code: "too_long" },
      message: `At most ${String(SHIPPING_LIMITS.lookupQueryMaxLength)} characters.`,
    });

const pageQuery = (maxLimit: number, defaultLimit: number) => ({
  limit: integerString
    .transform(Number)
    .pipe(z.number().int().min(1).max(maxLimit))
    .default(defaultLimit),
  offset: integerString
    .transform(Number)
    .pipe(z.number().int().min(0).max(CATALOG_LIMITS.maxOffset))
    .default(0),
});

export const CITIES_DEFAULT_PAGE_SIZE = 20;
export const PICKUP_POINTS_DEFAULT_PAGE_SIZE = 50;

export const shippingCitiesQuerySchema = z.strictObject({
  q: searchText(SHIPPING_LIMITS.lookupQueryMinLength).meta({
    description: `The start or part of a city name, ${String(SHIPPING_LIMITS.lookupQueryMinLength)} to ${String(SHIPPING_LIMITS.lookupQueryMaxLength)} characters after trimming.`,
  }),
  locale: localeQuery,
  ...pageQuery(SHIPPING_LIMITS.maxCitiesPerPage, CITIES_DEFAULT_PAGE_SIZE),
});

export type ShippingCitiesQuery = z.output<typeof shippingCitiesQuerySchema>;

const kindsList = z
  .string()
  .transform((value, context): PickupPointKind[] => {
    const parts = value.split(",");
    const kinds: PickupPointKind[] = [];
    for (const part of parts) {
      if (!PICKUP_POINT_KINDS.includes(part as PickupPointKind)) {
        context.addIssue({
          code: "custom",
          params: { code: "invalid_value" },
          message: "Unknown kind.",
        });
        return z.NEVER;
      }
      if (!kinds.includes(part as PickupPointKind)) {
        kinds.push(part as PickupPointKind);
      }
    }
    return kinds;
  })
  .meta({ description: "Comma-separated `branch`, `locker`; both by default." });

export const shippingPickupPointsQuerySchema = z.strictObject({
  cityRef: carrierRef.meta({ description: "The city (`GET .../cities`)." }),
  q: searchText(0)
    .optional()
    .meta({ description: "Filters by number or description (up to 50 characters)." }),
  kinds: kindsList.optional(),
  ...pageQuery(SHIPPING_LIMITS.maxPickupPointsPerPage, PICKUP_POINTS_DEFAULT_PAGE_SIZE),
});

export type ShippingPickupPointsQuery = z.output<typeof shippingPickupPointsQuerySchema>;

const amountSchema = z.number().int().min(0).max(MAX_AMOUNT);
const moneySchema = z.object({ amount: amountSchema, currency: z.string() });

export const shippingOptionSchema = z.object({
  methodCode: z.string(),
  kind: z.enum(SHIPPING_METHOD_KINDS),
  title: z.string(),
  description: z.string().nullable().meta({
    description: "The method's description; for `store_pickup` the pickup instructions.",
  }),
  providerCode: z.string().nullable(),
  countryCodes: z.array(z.string()).meta({ description: "The countries the method serves." }),
  available: z.boolean(),
  reason: z.enum(SHIPPING_QUOTE_UNAVAILABLE_REASONS).optional().meta({
    description: "Why the method is not available; only when `available` is false.",
  }),
  price: moneySchema.nullable().meta({
    description: "What the shop charges for shipping; `null` when not available.",
  }),
  payer: z.enum(SHIPPING_PAYERS).nullable(),
  total: moneySchema.nullable().meta({
    description:
      "The cart subtotal plus `price`, computed by the server: send it back as the checkout's `expectedTotal`. `null` when not available.",
  }),
  estimate: moneySchema.nullable().meta({
    description:
      "The carrier's own price, informational only (never charged): only when `cityRef` or `pickupPointRef` is sent and the provider answers in time.",
  }),
});

export type ShippingOption = z.output<typeof shippingOptionSchema>;

export const shippingOptionsResponseSchema = z.object({
  subtotal: moneySchema,
  options: z.array(shippingOptionSchema).meta({
    description:
      "Empty for an empty cart, a cart that ships nothing, and a shop without an active method.",
  }),
});

export type ShippingOptionsResponse = z.output<typeof shippingOptionsResponseSchema>;

/** The `shipping` member of `409 shipping_changed`: the fresh option, or the method is not offered at all any more. */
export const shippingChangedSchema = z.union([
  shippingOptionSchema,
  z.object({
    methodCode: z.string(),
    available: z.literal(false),
    reason: z.enum(["inactive", "currency_not_offered"]),
  }),
]);

export type ShippingChanged = z.output<typeof shippingChangedSchema>;

const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int().min(0),
    limit: z.number().int(),
    offset: z.number().int(),
    stale: z.boolean().meta({
      description:
        "The carrier could not be reached and the answer comes from data cached up to 72 hours past its expiry.",
    }),
  });

export const shippingCityPageSchema = pageOf(
  z.object({ ref: z.string(), name: z.string(), region: z.string().nullable() }),
);

export type ShippingCityPage = z.output<typeof shippingCityPageSchema>;

export const shippingPickupPointPageSchema = pageOf(
  z.object({
    ref: z.string().meta({ description: "Send it as the checkout's `shipping.pickupPointRef`." }),
    number: z.string(),
    kind: z.enum(PICKUP_POINT_KINDS),
    cityRef: z.string(),
    cityName: z.string(),
    countryCode: z.string(),
    description: z.string(),
    maxWeightGrams: z.number().int().nullable(),
  }),
);

export type ShippingPickupPointPage = z.output<typeof shippingPickupPointPageSchema>;
