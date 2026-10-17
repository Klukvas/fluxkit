import { CATALOG_LIMITS, MAX_AMOUNT, MAX_LINE_QUANTITY, ORDER_STATUSES } from "@fluxkit/core";
import { z } from "zod";
import { timestampSchema } from "../common/openapi-formats.js";

// Store order API shapes (docs/api/orders.md, ADR 0015, ADR 0017). Request schemas check structure only: the content
// of names, phone, email and addresses is judged by the core rules (`checkout-input.ts`), so a rule and its error code
// exist once.

const localeField = z
  .string()
  .min(1)
  .max(16)
  .meta({ description: "One of the configured locales. Missing means the default locale." });

// `countryCode`, `city` and `line1` are required, but judged by the core address rules together with every other
// field (one answer with all the errors), so the structure check here accepts them as missing.
const addressInput = z.strictObject({
  countryCode: z
    .string()
    .optional()
    .meta({ description: "Required. ISO 3166-1 alpha-2, upper case (pattern only)." }),
  region: z.string().optional(),
  city: z.string().optional().meta({ description: "Required." }),
  postalCode: z.string().optional(),
  line1: z.string().optional().meta({ description: "Required." }),
  line2: z.string().optional(),
  recipientFirstName: z.string().optional(),
  recipientLastName: z.string().optional(),
  recipientPhone: z.string().optional(),
});

export const checkoutBodySchema = z.strictObject({
  email: z.string().optional().meta({
    description: "Required for a guest; a signed-in customer's account email by default.",
  }),
  phone: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  shippingAddress: addressInput
    .nullable()
    .optional()
    .meta({ description: "Required when any line's product type ships physical goods." }),
  billingAddress: addressInput.nullable().optional(),
  locale: localeField.optional(),
  expectedTotal: z.strictObject({ amount: z.number(), currency: z.string() }).meta({
    description:
      "The total the shopper saw. A consent check only: the server prices everything itself, and a different total answers 409 `cart_changed`.",
  }),
});

export type CheckoutBody = z.output<typeof checkoutBodySchema>;

/** `POST /store/orders/lookup` and `POST /store/orders/cancel`. Lengths are bounded; the format is judged without leaking. */
export const guestOrderBodySchema = z.strictObject({
  number: z.string().max(64),
  accessToken: z.string().max(256),
});

export type GuestOrderBody = z.output<typeof guestOrderBodySchema>;

/** `?locale` of the order reads (`GET`, and the `POST` guest routes); default is the locale the order was placed in. */
export const orderLocaleQuerySchema = z.strictObject({ locale: localeField.optional() });

export type OrderLocaleQuery = z.output<typeof orderLocaleQuerySchema>;

const integerString = z.string().regex(/^\d{1,9}$/, "must be a non-negative integer");

export const ACCOUNT_ORDERS_DEFAULT_PAGE_SIZE = 24;

export const accountOrdersQuerySchema = z.strictObject({
  limit: integerString
    .transform(Number)
    .pipe(z.number().int().min(1).max(CATALOG_LIMITS.maxPageSize))
    .default(ACCOUNT_ORDERS_DEFAULT_PAGE_SIZE),
  offset: integerString
    .transform(Number)
    .pipe(z.number().int().min(0).max(CATALOG_LIMITS.maxOffset))
    .default(0),
  locale: localeField.optional(),
});

export type AccountOrdersQuery = z.output<typeof accountOrdersQuerySchema>;

const amountSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_AMOUNT)
  .meta({ description: "Minor units of the order currency." });

const moneySchema = z.object({ amount: amountSchema, currency: z.string() });

const signedMoneySchema = z.object({
  amount: z.number().int().min(-MAX_AMOUNT).max(MAX_AMOUNT),
  currency: z.string(),
});

const statusSchema = z.enum(ORDER_STATUSES);

const addressOutput = z.object({
  countryCode: z.string(),
  region: z.string().optional(),
  city: z.string(),
  postalCode: z.string().optional(),
  line1: z.string(),
  line2: z.string().optional(),
  recipientFirstName: z.string().optional(),
  recipientLastName: z.string().optional(),
  recipientPhone: z.string().optional(),
});

export const storeOrderItemSchema = z.object({
  sku: z.string(),
  productTitle: z.string(),
  variantTitle: z.string().nullable(),
  optionValues: z.array(z.object({ option: z.string(), value: z.string() })),
  imageUrl: z.string().nullable(),
  unitPrice: moneySchema,
  compareAtAmount: amountSchema.nullable(),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
  lineTotal: moneySchema,
});

export const storeOrderSchema = z.object({
  number: z.string().meta({
    description: "`XXXX-XXXX`. Not a secret: reading an order needs a session or a token.",
  }),
  status: statusSchema,
  placedAt: timestampSchema,
  expiresAt: timestampSchema.meta({
    description: "While the order is `awaiting_payment`: when it expires and gives its stock back.",
  }),
  currency: z.string(),
  items: z.array(storeOrderItemSchema),
  subtotal: moneySchema,
  shippingTotal: moneySchema,
  discountTotal: signedMoneySchema,
  taxTotal: moneySchema,
  total: moneySchema,
  adjustments: z.array(
    z.object({
      kind: z.string(),
      code: z.string(),
      label: z.string(),
      amount: signedMoneySchema,
      includedInPrice: z.boolean(),
    }),
  ),
  contact: z.object({
    email: z.string(),
    phone: z.string(),
    firstName: z.string(),
    lastName: z.string(),
  }),
  shippingAddress: addressOutput.nullable(),
  billingAddress: addressOutput.nullable(),
  history: z.array(z.object({ status: statusSchema, at: timestampSchema })),
});

export const storeOrderSummarySchema = z.object({
  number: z.string(),
  status: statusSchema,
  placedAt: timestampSchema,
  expiresAt: timestampSchema,
  total: moneySchema,
  itemCount: z.number().int().min(0).meta({ description: "Units over all lines." }),
});

export const storeOrderPageSchema = z.object({
  items: z.array(storeOrderSummarySchema),
  total: z.number().int().min(0),
  limit: z.number().int(),
  offset: z.number().int(),
});

export const checkoutResponseSchema = z.object({
  order: storeOrderSchema,
  accessToken: z.string().optional().meta({
    description:
      "Guests only: the secret that opens this order (`POST /store/orders/lookup`). Shown once; a replay of the same checkout returns a NEW token and the old one stops working.",
  }),
});

export type StoreOrder = z.output<typeof storeOrderSchema>;
export type StoreOrderSummary = z.output<typeof storeOrderSummarySchema>;
export type StoreOrderPage = z.output<typeof storeOrderPageSchema>;
export type CheckoutResponse = z.output<typeof checkoutResponseSchema>;
