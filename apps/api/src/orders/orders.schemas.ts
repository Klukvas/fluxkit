import {
  CATALOG_LIMITS,
  MAX_AMOUNT,
  MAX_LINE_QUANTITY,
  ORDER_STATUSES,
  PAYMENT_ATTENTION_CODES,
  PAYMENT_CREATED_BY,
  PAYMENT_EVENT_SOURCES,
  PAYMENT_ORDER_OUTCOMES,
  PAYMENT_STATUSES,
  REFUND_REASONS,
  REFUND_STATUSES,
  SHOPPER_PAYMENT_FAILURE_CATEGORIES,
  SHOPPER_PAYMENT_STATUSES,
  PICKUP_POINT_KINDS,
  SHIPMENT_ACTORS,
  SHIPMENT_PAYERS,
  SHIPMENT_STATUSES,
  SHIPPING_METHOD_KINDS,
  SHIPPING_PAYERS,
} from "@fluxkit/core";
import { z } from "zod";
import { timestampSchema, uuidSchema } from "../common/openapi-formats.js";

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
  shipping: z
    .strictObject({
      methodCode: z.string().meta({
        description: "The `methodCode` of an option of `GET /store/shipping/options`.",
      }),
      pickupPointRef: z.string().optional().meta({
        description:
          "Required for a `pickup_point` method, refused for the others: the `ref` of `GET /store/shipping/providers/{code}/pickup-points`.",
      }),
    })
    .nullable()
    .optional()
    .meta({
      description:
        "The shipping method (docs/api/shipping.md). Required when the cart ships goods and the shop has an active method; refused (`shipping_not_applicable`) for a cart that ships nothing. Missing or `null` means not sent.",
    }),
  expectedTotal: z.strictObject({ amount: z.number(), currency: z.string() }).meta({
    description:
      "The total the shopper saw: the subtotal, plus the option's price when a shipping method is chosen (send the option's `total`). A consent check only: the server prices everything itself; a different total answers 409 `cart_changed` or `shipping_changed`.",
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

export const amountSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_AMOUNT)
  .meta({ description: "Minor units of the order currency." });

export const moneySchema = z.object({ amount: amountSchema, currency: z.string() });

function moneySchemaOf() {
  return z.object({ amount: amountSchema, currency: z.string() });
}

export const signedMoneySchema = z.object({
  amount: z.number().int().min(-MAX_AMOUNT).max(MAX_AMOUNT),
  currency: z.string(),
});

export const statusSchema = z.enum(ORDER_STATUSES);

export const addressOutput = z.object({
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

/** The pickup point of a `pickup_point` order: public carrier data of the snapshot (`order_shipping.destination`). */
export const orderPickupPointSchema = z.object({
  providerRef: z.string(),
  number: z.string(),
  kind: z.enum(PICKUP_POINT_KINDS),
  cityRef: z.string(),
  cityName: z.string(),
  description: z.string(),
});

const orderShippingFields = {
  methodCode: z.string(),
  kind: z.enum(SHIPPING_METHOD_KINDS),
  providerCode: z.string().nullable(),
  amount: moneySchemaOf().meta({
    description: "What the shop charged for shipping; equals the shipping adjustment.",
  }),
  payer: z.enum(SHIPPING_PAYERS).meta({
    description: "`recipient_on_delivery`: the shop charged 0 and the recipient pays the carrier.",
  }),
  estimatedCarrierAmount: moneySchemaOf().nullable().meta({
    description: "The carrier's informational estimate known at checkout; never charged.",
  }),
  destination: orderPickupPointSchema.nullable().meta({ description: "Only for `pickup_point`." }),
};

/** The store view of the shipping snapshot (ADR 0029 decision 5): the method title in the read's locale. */
export const storeOrderShippingSchema = z.object({
  ...orderShippingFields,
  title: z.string(),
});

/** The admin view of the shipping snapshot: every locale of the title, the method link and the provider service. */
export const adminOrderShippingSchema = z.object({
  methodId: z.string().nullable().meta({ description: "Null once the method was deleted." }),
  ...orderShippingFields,
  providerService: z.string().nullable(),
  title: z.record(z.string(), z.string()),
});

export const shipmentStatusSchema = z.enum(SHIPMENT_STATUSES);

/**
 * A carrier waybill as the shopper sees it (ADR 0029 decision 5): only one that has a waybill number (the carrier
 * answered), with the normalized status. No carrier text, no reference, no parcel data.
 */
export const storeShipmentSchema = z.object({
  providerCode: z.string(),
  trackingNumber: z.string(),
  status: shipmentStatusSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  deliveredAt: timestampSchema.nullable(),
  cancelledAt: timestampSchema.nullable(),
});

/**
 * A carrier waybill as an admin (and `OrderReadPort`) sees it (ADR 0029 decision 10). No recipient name or phone and no
 * carrier text: the raw carrier code only. `unknown`: the carrier's answer to the creation was lost; settle it with
 * `POST .../shipments/{shipmentId}/reconcile`.
 */
export const adminShipmentSchema = z.object({
  id: uuidSchema,
  status: shipmentStatusSchema,
  providerCode: z.string(),
  providerService: z.string().nullable(),
  trackingNumber: z.string().nullable().meta({ description: "Null until the carrier answered." }),
  carrierStatusCode: z
    .string()
    .nullable()
    .meta({ description: "The raw carrier code, never text." }),
  carrierStatusAt: timestampSchema.nullable(),
  clientReference: z.string().meta({ description: "Our order number as sent to the carrier." }),
  declaredValue: moneySchemaOf(),
  carrierCost: moneySchemaOf()
    .nullable()
    .meta({ description: "The carrier's price of the waybill: informational, never charged." }),
  payer: z.enum(SHIPMENT_PAYERS),
  weightGrams: z.number().int().min(1),
  lengthMm: z.number().int().min(1),
  widthMm: z.number().int().min(1),
  heightMm: z.number().int().min(1),
  seats: z.number().int().min(1),
  createdBy: uuidSchema.nullable().meta({ description: "Null once that admin user was deleted." }),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  cancelledAt: timestampSchema.nullable(),
  deliveredAt: timestampSchema.nullable(),
  nextTrackAt: timestampSchema.nullable().meta({
    description:
      "When the tracking job asks the carrier next; null when it does not (no waybill yet, terminal, or given up after 30 days).",
  }),
  history: z.array(
    z.object({
      fromStatus: shipmentStatusSchema.nullable(),
      toStatus: shipmentStatusSchema,
      carrierStatusCode: z.string().nullable(),
      actorType: z.enum(SHIPMENT_ACTORS),
      actorAdminId: uuidSchema.nullable(),
      at: timestampSchema,
    }),
  ),
});

export const adminPaymentRefundSchema = z.object({
  id: uuidSchema.meta({ description: "Also the idempotency reference sent to the provider." }),
  amount: moneySchema,
  status: z.enum(REFUND_STATUSES).meta({
    description:
      "`requested`: not sent yet (or throttled; the reconcile job sends it). `unknown`: the provider's answer was lost; settled from the provider's refund list, never sent again.",
  }),
  reason: z.enum(REFUND_REASONS),
  note: z
    .string()
    .nullable()
    .meta({ description: "The admin's note; null for an automatic refund." }),
  actorAdminId: uuidSchema.nullable(),
  failureCode: z
    .string()
    .nullable()
    .meta({ description: "The provider's code of a failed refund, never text." }),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const adminPaymentHistorySchema = z.object({
  source: z.enum(PAYMENT_EVENT_SOURCES),
  fromStatus: z.enum(PAYMENT_STATUSES).nullable(),
  toStatus: z.enum(PAYMENT_STATUSES).nullable(),
  providerStatus: z.string().nullable().meta({ description: "The provider's raw status word." }),
  providerModifiedAt: timestampSchema.nullable(),
  applied: z.boolean().meta({
    description:
      "False for a fact that was older than the current state, did not bind or changed nothing.",
  }),
  failureCode: z.string().nullable(),
  actorAdminId: uuidSchema.nullable(),
  action: z.enum(["attention_cleared"]).nullable().meta({
    description: "An admin action without a status change: `attention_cleared`; null otherwise.",
  }),
  at: timestampSchema,
});

export const adminPaymentSchema = z.object({
  id: uuidSchema,
  providerCode: z.string(),
  providerPaymentId: z.string().nullable().meta({
    description: "The provider's invoice id; null until the provider answered the create.",
  }),
  status: z.enum(PAYMENT_STATUSES),
  amount: moneySchema,
  finalAmount: moneySchema.nullable(),
  refundedAmount: moneySchema.meta({ description: "The sum of the succeeded refunds." }),
  refundableAmount: moneySchema.meta({
    description:
      "What a new refund may still take: for a succeeded payment the amount less every refund that is not failed and less money the provider returned outside the shop (from its final amount), at least 0; else 0.",
  }),
  providerStatus: z.string().nullable(),
  providerModifiedAt: timestampSchema.nullable(),
  failureCode: z
    .string()
    .nullable()
    .meta({ description: "A provider or outcome code, never text." }),
  orderOutcome: z.enum(PAYMENT_ORDER_OUTCOMES).nullable(),
  needsAttention: z.boolean(),
  attentionCode: z
    .enum(PAYMENT_ATTENTION_CODES)
    .nullable()
    .meta({ description: "Kept after an admin cleared the item." }),
  card: z
    .object({ system: z.string(), last4: z.string() })
    .nullable()
    .meta({ description: "The card system and the last four digits only." }),
  createdBy: z.enum(PAYMENT_CREATED_BY),
  expiresAt: timestampSchema.meta({ description: "The end of the provider's invoice." }),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  nextCheckAt: timestampSchema.nullable().meta({
    description: "When the reconcile job reads the provider next; null when it does not.",
  }),
  refunds: z.array(adminPaymentRefundSchema),
  history: z.array(adminPaymentHistorySchema).meta({
    description:
      "Status changes, provider facts and admin actions, oldest first (internal bookkeeping rows are left out).",
  }),
});

/** The shopper's view of one payment attempt (ADR 0032 decision 6): a small status set, never provider data. */
export const shopperPaymentStatusSchema = z.enum(SHOPPER_PAYMENT_STATUSES).meta({
  description:
    "`waiting`: the provider's page is open; `processing`: the provider (or our create call) is still working, the order updates by itself; `paid`; `failed` (see `failureCategory`); `expired`: the invoice ended or a newer attempt replaced it.",
});

export const shopperPaymentFailureCategorySchema = z
  .enum(SHOPPER_PAYMENT_FAILURE_CATEGORIES)
  .nullable()
  .meta({
    description:
      "Only for `failed` and `expired`: `declined` (the provider reported a failed payment), `expired`, `technical` (no invoice could be made), `not_accepted` (the money was taken but the order could not take it: it is refunded or the shop settles it).",
  });

/** The `payment` member of the store order views (ADR 0032 decision 18). */
export const storeOrderPaymentSchema = z.object({
  canPay: z.boolean().meta({
    description:
      "Whether `POST .../payments` would start a new attempt now (the order awaits payment, an online provider takes its currency, no payment is in progress, enough time is left).",
  }),
  providers: z.array(z.string()).meta({
    description:
      "The enabled online payment providers that take the order currency; empty when online payment is off.",
  }),
  latest: z
    .object({
      paymentId: uuidSchema,
      status: shopperPaymentStatusSchema,
      failureCategory: shopperPaymentFailureCategorySchema,
      expiresAt: timestampSchema.meta({ description: "The end of the provider's invoice." }),
      redirectUrl: z.string().nullable().meta({
        description:
          "The provider's payment page while the status is `waiting` (continue the payment there); null otherwise.",
      }),
    })
    .nullable()
    .meta({ description: "The newest payment attempt of the order; null when none was made." }),
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
  contact: z
    .object({
      email: z.string().nullable(),
      phone: z.string().nullable(),
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
    })
    .meta({
      description:
        "All four are null once the contact data was erased (privacy erasure or retention, ADR 0033); otherwise all four are set.",
    }),
  shippingAddress: addressOutput.nullable(),
  billingAddress: addressOutput.nullable(),
  shipping: storeOrderShippingSchema.nullable().meta({
    description:
      "The shipping method chosen at checkout (immutable snapshot); null for an order placed without one.",
  }),
  shipments: z.array(storeShipmentSchema).meta({
    description:
      "The carrier waybills of the order that have a number, oldest first; empty until the shop created one.",
  }),
  history: z.array(z.object({ status: statusSchema, at: timestampSchema })),
  payment: storeOrderPaymentSchema,
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
export type StoreOrderPayment = z.output<typeof storeOrderPaymentSchema>;
export type AdminPayment = z.output<typeof adminPaymentSchema>;
export type AdminPaymentRefund = z.output<typeof adminPaymentRefundSchema>;
export type StoreOrderSummary = z.output<typeof storeOrderSummarySchema>;
export type StoreOrderPage = z.output<typeof storeOrderPageSchema>;
export type CheckoutResponse = z.output<typeof checkoutResponseSchema>;
