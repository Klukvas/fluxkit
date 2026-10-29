import { ORDER_STATUSES, PAYMENT_PROVIDER_CODE_PATTERN } from "@fluxkit/core";
import { z } from "zod";
import { timestampSchema, uuidSchema } from "../../common/openapi-formats.js";
import {
  shopperPaymentFailureCategorySchema,
  shopperPaymentStatusSchema,
} from "../../orders/orders.schemas.js";

// Store payment API shapes (docs/api/payments.md, ADR 0032 decisions 6 and 18). Strict bodies: an amount, a currency
// or any other member is a `400`; the amount of an attempt is always the order total read by the server.

const localeField = z.string().min(1).max(16).meta({
  description:
    "The storefront locale of the return page (`/{locale}/payment/return`); one of the configured locales. Missing means the order's locale.",
});

const providerField = z.string().max(64).regex(PAYMENT_PROVIDER_CODE_PATTERN).meta({
  description:
    "An enabled payment provider code (`GET /store/config` tells whether online payment is on). Optional while one provider is enabled.",
});

/** `POST /store/orders/payments`: the guest's number and access token, as for the order lookup. */
export const guestCreatePaymentBodySchema = z.strictObject({
  number: z.string().max(64),
  accessToken: z.string().max(256),
  provider: providerField.optional(),
  locale: localeField.optional(),
});

/** `POST /store/account/orders/{number}/payments`: the order comes from the path and the session; the body is optional. */
export const customerCreatePaymentBodySchema = z
  .strictObject({
    provider: providerField.optional(),
    locale: localeField.optional(),
  })
  .optional()
  .transform((value) => value ?? {});

/** `POST /store/orders/payments/status`. */
export const guestPaymentStatusBodySchema = z.strictObject({
  number: z.string().max(64),
  accessToken: z.string().max(256),
  paymentId: uuidSchema,
});

export const storeCreatedPaymentSchema = z.object({
  paymentId: uuidSchema,
  status: shopperPaymentStatusSchema,
  redirectUrl: z.string().nullable().meta({
    description:
      "The provider's payment page (`https`): navigate there (`window.location.assign`). Null when the attempt is not waiting for the shopper.",
  }),
  expiresAt: timestampSchema.meta({ description: "The end of the provider's invoice." }),
});

export const storePaymentStatusSchema = z.object({
  paymentId: uuidSchema,
  status: shopperPaymentStatusSchema,
  failureCategory: shopperPaymentFailureCategorySchema,
  expiresAt: timestampSchema.meta({ description: "The end of the provider's invoice." }),
  orderStatus: z.enum(ORDER_STATUSES),
  canRetry: z.boolean().meta({
    description:
      "Whether a new attempt would be accepted now (`POST .../payments` with a new `Idempotency-Key`).",
  }),
});

export type GuestCreatePaymentBody = z.output<typeof guestCreatePaymentBodySchema>;
export type CustomerCreatePaymentBody = z.output<typeof customerCreatePaymentBodySchema>;
export type GuestPaymentStatusBody = z.output<typeof guestPaymentStatusBodySchema>;
export type StoreCreatedPayment = z.output<typeof storeCreatedPaymentSchema>;
export type StorePaymentStatus = z.output<typeof storePaymentStatusSchema>;
