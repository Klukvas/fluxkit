import { MAX_ON_HAND } from "@fluxkit/core";
import { z } from "zod";
import { isDatabaseSafeText, UNSAFE_TEXT_MESSAGE } from "../../catalog/shared/text.js";
import { timestampSchema, uuidSchema } from "../../common/openapi-formats.js";
import { pageSchema, paginationQuerySchema } from "../../common/pagination.js";

// Schemas check structure only. Whole numbers, the range, the floor at zero and the reserved units are decided by
// the core stock rules (`decideAdjustment`) in the service, so the error codes are the core reasons.

export const MAX_REASON_LENGTH = 500;
export const MAX_REFERENCE_LENGTH = 255;

const reasonSchema = z
  .string()
  .trim()
  .max(MAX_REASON_LENGTH)
  .refine(isDatabaseSafeText, { error: UNSAFE_TEXT_MESSAGE })
  .meta({ description: `Free text, at most ${MAX_REASON_LENGTH} characters. Empty means none.` });

const referenceSchema = z
  .string()
  .trim()
  .max(MAX_REFERENCE_LENGTH)
  .refine(isDatabaseSafeText, { error: UNSAFE_TEXT_MESSAGE })
  .meta({
    description: `External reference such as a purchase order number, at most ${MAX_REFERENCE_LENGTH} characters. Empty means none.`,
  });

/** Kinds an admin may write. `sale` is written only when a reservation is committed. */
export const ADJUSTMENT_KINDS = ["receipt", "adjustment", "return"] as const;

/**
 * `POST .../inventory/adjustments`: change `on_hand` by `delta` or set it to `setOnHand` (exactly one of them).
 * `locationId` defaults to the default location. The level row is created by the first change that is accepted.
 */
export const adjustmentSchema = z
  .strictObject({
    locationId: z.guid().meta({ format: "uuid" }).optional(),
    delta: z
      .number()
      .optional()
      .meta({
        description: `Signed whole number of units to add (negative removes). The result must stay within 0 and ${MAX_ON_HAND} and not below the reserved units.`,
      }),
    setOnHand: z.number().optional().meta({
      description: "The counted quantity; the delta is computed under the row lock.",
    }),
    kind: z.enum(ADJUSTMENT_KINDS).meta({
      description:
        "receipt and return must add stock; adjustment may add or remove (a count, damage, loss).",
    }),
    reason: reasonSchema.nullable().optional(),
    reference: referenceSchema.nullable().optional(),
  })
  .superRefine((value, context) => {
    if ((value.delta === undefined) === (value.setOnHand === undefined)) {
      context.addIssue({
        code: "custom",
        message: "Send exactly one of delta and setOnHand.",
        params: { code: "delta_or_set_on_hand" },
      });
    }
  });

export const listMovementsQuerySchema = paginationQuerySchema;

/** The states of a reservation (`reservation_status_check`). */
export const RESERVATION_STATUSES = ["active", "committed", "released", "expired"] as const;

/** `?status` of the reservations list; `active` (the units currently held) unless another is asked for. */
export const listReservationsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(RESERVATION_STATUSES).default("active"),
});

export const levelResponseSchema = z.object({
  locationId: uuidSchema,
  locationCode: z.string(),
  onHand: z.number().int().min(0),
  reserved: z.number().int().min(0),
  available: z.number().int().min(0).meta({ description: "max(0, onHand - reserved)." }),
});

export const inventoryResponseSchema = z.object({
  variantId: uuidSchema,
  trackInventory: z.boolean(),
  allowBackorder: z.boolean(),
  levels: z.array(levelResponseSchema).meta({
    description: "Only locations that hold a level row; none for a variant that never had stock.",
  }),
  totalAvailable: z
    .number()
    .int()
    .min(0)
    .meta({ description: "Sum of available over the levels, whatever the flags say." }),
});

/** `GET /admin/products/:id/inventory`: one entry per variant, each exactly the shape of the per-variant read. */
export const productInventoryResponseSchema = z.object({ items: z.array(inventoryResponseSchema) });

/**
 * One reservation of a variant. Nothing about the buyer: `reference` is the order number of an order's hold (null for a
 * hold made by something else) and `orderId` links the order (null when no order owns the hold).
 */
export const reservationListItemSchema = z.object({
  status: z.enum(RESERVATION_STATUSES),
  quantity: z.number().int().min(1),
  expiresAt: timestampSchema,
  reference: z.string().nullable(),
  orderId: uuidSchema.nullable(),
  locationCode: z.string(),
  createdAt: timestampSchema,
});

export const reservationPageSchema = pageSchema(reservationListItemSchema);

export const movementResponseSchema = z.object({
  id: uuidSchema,
  variantId: uuidSchema,
  locationId: uuidSchema,
  locationCode: z.string(),
  kind: z.enum(["receipt", "adjustment", "sale", "return"]),
  delta: z.number().int(),
  onHandAfter: z.number().int().min(0),
  reason: z.string().nullable(),
  reference: z.string().nullable(),
  actorId: uuidSchema.nullable().meta({
    description: "The admin user who made the change; null for a system change or a deleted user.",
  }),
  createdAt: timestampSchema,
});

export const adjustmentResponseSchema = z.object({
  level: levelResponseSchema,
  movement: movementResponseSchema,
});

export const movementPageSchema = pageSchema(movementResponseSchema);

export type AdjustmentBody = z.output<typeof adjustmentSchema>;
export type ListMovementsQuery = z.output<typeof listMovementsQuerySchema>;
export type LevelResponse = z.output<typeof levelResponseSchema>;
export type InventoryResponse = z.output<typeof inventoryResponseSchema>;
export type ProductInventoryResponse = z.output<typeof productInventoryResponseSchema>;
export type ListReservationsQuery = z.output<typeof listReservationsQuerySchema>;
export type ReservationListItem = z.output<typeof reservationListItemSchema>;
export type MovementResponse = z.output<typeof movementResponseSchema>;
export type AdjustmentResponse = z.output<typeof adjustmentResponseSchema>;
