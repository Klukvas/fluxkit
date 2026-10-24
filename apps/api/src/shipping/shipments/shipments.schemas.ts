import { createMoney, PROVIDER_FAILURE_REASONS, SHIPMENT_PAYERS, type Money } from "@fluxkit/core";
import { z } from "zod";
import { trimmedText } from "../../orders/admin/admin-orders.schemas.js";
import { adminShipmentSchema } from "../../orders/orders.schemas.js";

// Shipment route shapes (docs/api/shipping.md, ADR 0029 decision 10). The parcel is what the admin enters per waybill
// (owner answer 5: no weight in the catalog). The recipient is never sent: it is read from the order.

/** Largest parcel figures accepted (a sanity bound; each carrier refuses what it does not take). */
export const PARCEL_LIMITS = Object.freeze({
  maxWeightGrams: 1_000_000,
  maxSideMm: 10_000,
  descriptionMaxLength: 200,
});

const declaredValueSchema = z
  .strictObject({
    amount: z.number().meta({ description: "Integer minor units of the order currency." }),
    currency: z.string().meta({ description: "ISO 4217 code; must be the order currency." }),
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
      context.addIssue({
        code: "custom",
        path: ["amount"],
        message: "A declared value is not negative.",
        params: { code: "negative_amount" },
      });
      return z.NEVER;
    }
    return created.money;
  });

const side = (name: string) =>
  z
    .number()
    .int()
    .min(1)
    .max(PARCEL_LIMITS.maxSideMm)
    .meta({ description: `${name} in millimetres, 1 to ${String(PARCEL_LIMITS.maxSideMm)}.` });

/** `POST /admin/orders/{id}/shipments`. One parcel (seats are always 1 in v1). */
export const createShipmentSchema = z.strictObject({
  weightGrams: z
    .number()
    .int()
    .min(1)
    .max(PARCEL_LIMITS.maxWeightGrams)
    .meta({ description: `Parcel weight in grams, 1 to ${String(PARCEL_LIMITS.maxWeightGrams)}.` }),
  lengthMm: side("Length"),
  widthMm: side("Width"),
  heightMm: side("Height"),
  description: trimmedText(PARCEL_LIMITS.descriptionMaxLength).meta({
    description: `Cargo description for the carrier; trimmed, 1 to ${String(PARCEL_LIMITS.descriptionMaxLength)} characters. Sent to the carrier only, never stored.`,
  }),
  declaredValue: declaredValueSchema.optional().meta({
    description:
      "The value declared to the carrier, in the order currency. Missing: the order subtotal.",
  }),
  payer: z.enum(SHIPMENT_PAYERS).optional().meta({
    description:
      "Who pays the carrier. Missing: `recipient` for a method the recipient pays on delivery, else `sender`.",
  }),
});

export type CreateShipmentBody = z.output<typeof createShipmentSchema>;

export const providerFailureSchema = z.object({
  reason: z.enum(PROVIDER_FAILURE_REASONS),
  providerCodes: z
    .array(z.string())
    .meta({ description: "Raw carrier codes, never message text." }),
});

/** The answer of a create: the shipment as it now is, and why the carrier refused it (when it did). */
export const createShipmentResultSchema = z.object({
  shipment: adminShipmentSchema.meta({
    description:
      "`created`: the carrier accepted the waybill. `failed`: it refused (see `failure`). `unknown`: the answer was lost (timeout, network) and whether a waybill exists is not known: do NOT create again, call `POST .../reconcile`.",
  }),
  failure: providerFailureSchema.nullable().meta({
    description: "The carrier's typed refusal of a `failed` shipment; null otherwise.",
  }),
});

export type CreateShipmentResult = z.output<typeof createShipmentResultSchema>;

export const shipmentListSchema = z.object({
  items: z.array(adminShipmentSchema).meta({ description: "Oldest first; at most one is active." }),
});

export type ShipmentList = z.output<typeof shipmentListSchema>;
