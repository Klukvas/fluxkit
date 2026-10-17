import {
  CATALOG_LIMITS,
  createMoney,
  EMAIL_MAX_LENGTH,
  MAX_LINE_QUANTITY,
  ORDER_ACTORS,
  ORDER_STATUSES,
  type Money,
} from "@fluxkit/core";
import { z } from "zod";
import { timestampSchema, uuidSchema } from "../../common/openapi-formats.js";
import {
  addressOutput,
  moneySchema,
  signedMoneySchema,
  statusSchema,
} from "../orders.schemas.js";

// Admin order API shapes (docs/api/orders.md, plan step 6). Request schemas check structure and the content rules that
// have no home in core (a free-text reason, a payment reference); money is judged by core `createMoney`.

export const ADMIN_ORDERS_DEFAULT_PAGE_SIZE = 20;
/** Instants outside this window are refused: no order is older, and nothing sane lies beyond. */
export const ORDER_FILTER_MIN_INSTANT = new Date("2000-01-01T00:00:00.000Z");
export const ORDER_FILTER_MAX_INSTANT = new Date("2200-01-01T00:00:00.000Z");
export const CANCELLATION_REASON_MAX_LENGTH = 500;
export const PAYMENT_REFERENCE_MAX_LENGTH = 255;

const integerString = z.string().regex(/^\d{1,9}$/, "must be a non-negative integer");

/** Control characters other than tab, line feed and carriage return (NUL is not even storable in Postgres text). */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const isAllowedWhitespace = code === 0x09 || code === 0x0a || code === 0x0d;
    if (!isAllowedWhitespace && (code <= 0x1f || (code >= 0x7f && code <= 0x9f))) {
      return true;
    }
  }
  return false;
}

/** A trimmed text of 1 to `max` characters without control characters. */
function trimmedText(max: number) {
  return z
    .string()
    .transform((value) => value.trim())
    .pipe(
      z
        .string()
        .min(1)
        .max(max)
        .refine((value) => !hasControlCharacter(value), {
          message: "must not contain control characters",
          params: { code: "invalid_characters" },
        }),
    );
}

/** An ISO 8601 instant with `Z` or an offset, inside the sane window. */
const instantSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .refine(
    (value) =>
      !Number.isNaN(value.getTime()) &&
      value.getTime() >= ORDER_FILTER_MIN_INSTANT.getTime() &&
      value.getTime() < ORDER_FILTER_MAX_INSTANT.getTime(),
    { message: "must be between 2000-01-01 and 2200-01-01", params: { code: "out_of_range" } },
  );

/**
 * `GET /admin/orders`. Strict: a misspelt filter is a `400`, never a silent "all orders". `placedFrom` is inclusive,
 * `placedTo` exclusive. `q` is an exact order number (the way a person types it) or an exact email; an empty `q`
 * is no filter.
 */
export const listAdminOrdersQuerySchema = z
  .strictObject({
    limit: integerString
      .transform(Number)
      .pipe(z.number().int().min(1).max(CATALOG_LIMITS.maxPageSize))
      .default(ADMIN_ORDERS_DEFAULT_PAGE_SIZE),
    offset: integerString
      .transform(Number)
      .pipe(z.number().int().min(0).max(CATALOG_LIMITS.maxOffset))
      .default(0),
    status: z.enum(ORDER_STATUSES).optional(),
    placedFrom: instantSchema.optional(),
    placedTo: instantSchema.optional(),
    q: z.string().max(EMAIL_MAX_LENGTH).optional(),
  })
  .superRefine((query, context) => {
    if (
      query.placedFrom !== undefined &&
      query.placedTo !== undefined &&
      query.placedFrom.getTime() > query.placedTo.getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["placedTo"],
        message: "must not be before placedFrom",
        params: { code: "before_placed_from" },
      });
    }
  });

/** `POST /admin/orders/:id/cancel`. */
export const cancelOrderSchema = z.strictObject({
  reason: trimmedText(CANCELLATION_REASON_MAX_LENGTH).meta({
    description: `Why the order is cancelled; trimmed, 1 to ${String(CANCELLATION_REASON_MAX_LENGTH)} characters. Kept on the order and in the status journal.`,
  }),
});

const paymentAmountSchema = z
  .strictObject({
    amount: z.number().meta({ description: "Integer minor units of the order currency." }),
    currency: z.string().meta({ description: "ISO 4217 code of the order currency." }),
  })
  .transform((value, context): Money => {
    const created = createMoney(value.amount, value.currency);
    if (!created.ok) {
      context.addIssue({
        code: "custom",
        path: [created.reason === "unsupported_currency" ? "currency" : "amount"],
        message: created.reason,
        params: { code: created.reason },
      });
      return z.NEVER;
    }
    if (created.money.amount < 0) {
      // `createMoney` allows signed amounts (refunds, discounts); a payment received never is negative.
      context.addIssue({
        code: "custom",
        path: ["amount"],
        message: "A payment amount is not negative.",
        params: { code: "negative_amount" },
      });
      return z.NEVER;
    }
    return created.money;
  });

/** `POST /admin/orders/:id/mark-paid`. */
export const markPaidSchema = z.strictObject({
  reference: trimmedText(PAYMENT_REFERENCE_MAX_LENGTH).meta({
    description: `The payment reference (bank transfer number, receipt); trimmed, 1 to ${String(PAYMENT_REFERENCE_MAX_LENGTH)} characters. The idempotency key of the payment.`,
  }),
  amount: paymentAmountSchema.meta({
    description: "Must equal the order total exactly, in the order currency.",
  }),
});

export type ListAdminOrdersQuery = z.output<typeof listAdminOrdersQuerySchema>;
export type CancelOrderBody = z.output<typeof cancelOrderSchema>;
export type MarkPaidBody = z.output<typeof markPaidSchema>;

// ---- Responses ----

const textsSchema = z.record(z.string(), z.string());

export const adminOrderSummarySchema = z.object({
  id: uuidSchema,
  number: z.string(),
  status: statusSchema,
  placedAt: timestampSchema,
  expiresAt: timestampSchema,
  total: moneySchema,
  currency: z.string(),
  customerId: uuidSchema.nullable().meta({
    description: "Null for a guest order and for an order whose customer account was deleted.",
  }),
  email: z.string(),
  itemCount: z.number().int().min(0).meta({ description: "Units over all lines." }),
});

export const adminOrderItemSchema = z.object({
  position: z.number().int().min(0),
  productId: uuidSchema.nullable(),
  variantId: uuidSchema.nullable(),
  sku: z.string(),
  productTitle: textsSchema.meta({ description: "Every locale of the snapshot." }),
  variantTitle: textsSchema.nullable(),
  optionValues: z.array(z.object({ option: textsSchema, value: textsSchema })),
  imageUrl: z.string().nullable(),
  unitPrice: moneySchema,
  compareAtAmount: z.number().int().min(0).nullable(),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
  lineTotal: moneySchema,
  requiresShipping: z.boolean(),
  reservations: z.array(z.object({ status: z.string(), quantity: z.number().int().min(1) })).meta({
    description: "Status and quantity only; never an id, a location or a stock figure.",
  }),
});

export const adminOrderSchema = z.object({
  id: uuidSchema,
  number: z.string(),
  status: statusSchema,
  locale: z.string(),
  currency: z.string(),
  customerId: uuidSchema.nullable(),
  isGuest: z
    .boolean()
    .meta({ description: "Placed without an account (the shopper holds a guest token)." }),
  contact: z.object({
    email: z.string(),
    phone: z.string(),
    firstName: z.string(),
    lastName: z.string(),
  }),
  shippingAddress: addressOutput.nullable(),
  billingAddress: addressOutput.nullable(),
  items: z.array(adminOrderItemSchema),
  subtotal: moneySchema,
  shippingTotal: moneySchema,
  discountTotal: signedMoneySchema,
  taxTotal: moneySchema,
  total: moneySchema,
  adjustments: z.array(
    z.object({
      kind: z.string(),
      code: z.string(),
      label: textsSchema,
      amount: signedMoneySchema,
      includedInPrice: z.boolean(),
      source: z.string().nullable(),
    }),
  ),
  history: z.array(
    z.object({
      fromStatus: statusSchema.nullable(),
      toStatus: statusSchema,
      actorType: z.enum(ORDER_ACTORS),
      actorAdminId: uuidSchema.nullable(),
      reason: z.string().nullable(),
      at: timestampSchema,
    }),
  ),
  placedAt: timestampSchema,
  expiresAt: timestampSchema,
  paidAt: timestampSchema.nullable(),
  fulfilledAt: timestampSchema.nullable(),
  cancelledAt: timestampSchema.nullable(),
  expiredAt: timestampSchema.nullable(),
  cancellationReason: z.string().nullable(),
  paymentReference: z.string().nullable(),
});

export type AdminOrderSummary = z.output<typeof adminOrderSummarySchema>;
export type AdminOrderDetail = z.output<typeof adminOrderSchema>;
