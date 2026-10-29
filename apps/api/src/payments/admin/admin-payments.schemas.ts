import { createMoney, CATALOG_LIMITS, PAYMENT_LIMITS, type Money } from "@fluxkit/core";
import { z } from "zod";
import { uuidSchema } from "../../common/openapi-formats.js";
import { trimmedText } from "../../orders/admin/admin-orders.schemas.js";
import { adminPaymentRefundSchema, adminPaymentSchema } from "../../orders/orders.schemas.js";

// Admin payment API shapes (docs/api/payments.md, ADR 0032 decisions 11 and 18). The payment view itself
// (`adminPaymentSchema`) lives next to the order views in `orders.schemas.ts`, like the shipment view, because the admin
// order view carries it too.

export const ADMIN_PAYMENTS_DEFAULT_PAGE_SIZE = 20;

export const adminPaymentListItemSchema = z.object({
  orderId: uuidSchema,
  orderNumber: z.string(),
  payment: adminPaymentSchema,
});

export const adminPaymentPageSchema = z.object({
  items: z.array(adminPaymentListItemSchema),
  limit: z.number().int(),
  nextCursor: z.string().nullable().meta({
    description: "Pass as `cursor` for the next page; null on the last page. Opaque.",
  }),
});

export const adminPaymentListSchema = z.object({
  items: z.array(adminPaymentSchema).meta({
    description: "The payment attempts of the order, oldest first; empty when none was made.",
  }),
});

export const adminRefundResultSchema = z.object({
  refund: adminPaymentRefundSchema.meta({
    description:
      "The refund as the provider left it: `succeeded`, `processing` (the provider settles it later), `failed`, `requested` (throttled; the reconcile job sends it) or `unknown` (the answer was lost: never sent again, settled from the provider's refund list).",
  }),
  payment: adminPaymentSchema.meta({ description: "The payment attempt afterwards." }),
});

const refundAmountSchema = z
  .strictObject({
    amount: z.number().meta({ description: "Integer minor units of the payment currency." }),
    currency: z.string().meta({ description: "ISO 4217 code of the payment currency." }),
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
    if (created.money.amount < 1) {
      context.addIssue({
        code: "custom",
        path: ["amount"],
        message: "A refund is at least one minor unit.",
        params: { code: "invalid_amount" },
      });
      return z.NEVER;
    }
    return created.money;
  });

/** `POST /admin/orders/{id}/payments/{paymentId}/refunds`. Never more than the payment: the service decides under its lock. */
export const refundPaymentSchema = z.strictObject({
  amount: refundAmountSchema.meta({
    description:
      "The amount to refund, at most `refundableAmount`; a partial amount only when the provider takes partial refunds.",
  }),
  note: trimmedText(PAYMENT_LIMITS.refundNoteMaxLength).meta({
    description: `Why the money is returned; trimmed, ${String(PAYMENT_LIMITS.refundNoteMinLength)} to ${String(PAYMENT_LIMITS.refundNoteMaxLength)} characters. Kept on the refund.`,
  }),
});

const integerString = z.string().regex(/^\d{1,9}$/, "must be a non-negative integer");

/** `GET /admin/payments`. Strict: a misspelt filter is a `400`, never a silent "all payments". */
export const listAdminPaymentsQuerySchema = z.strictObject({
  needsAttention: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  limit: integerString
    .transform(Number)
    .pipe(z.number().int().min(1).max(CATALOG_LIMITS.maxPageSize))
    .default(ADMIN_PAYMENTS_DEFAULT_PAGE_SIZE),
  cursor: z.string().max(200).optional(),
});

export type AdminPayment = z.output<typeof adminPaymentSchema>;
export type AdminPaymentRefund = z.output<typeof adminPaymentRefundSchema>;
export type AdminPaymentPage = z.output<typeof adminPaymentPageSchema>;
export type AdminPaymentList = z.output<typeof adminPaymentListSchema>;
export type AdminRefundResult = z.output<typeof adminRefundResultSchema>;
export type RefundPaymentBody = z.output<typeof refundPaymentSchema>;
export type ListAdminPaymentsQuery = z.output<typeof listAdminPaymentsQuerySchema>;
