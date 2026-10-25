import { z } from "zod";

/*
 * The answers the plugin reads, as observed on production (spike 7a and its rerun, 2026-10-25) or documented where nothing
 * was observed. Objects are loose (unknown fields pass); the fields the plugin uses are checked strictly. Ids of
 * settlements and divisions are integers (never `externalId`); shipment ids are uuids; numbers are digit strings.
 */

const id = z.number().int().positive().max(2_147_483_647);
const text = z.string().trim().min(1);

/** `{current_page, last_page, per_page, total, from, to, items}` of every paged list. */
export const pageSchema = z.looseObject({
  current_page: z.number().int().nonnegative(),
  last_page: z.number().int().nonnegative(),
  total: z.number().int().nonnegative().optional(),
  items: z.array(z.unknown()),
});

export const settlementSchema = z.looseObject({
  id,
  name: text,
  region: z
    .looseObject({
      name: z.string().nullable().optional(),
      parent: z.looseObject({ name: z.string().nullable().optional() }).nullable().optional(),
    })
    .nullable()
    .optional(),
});

export const divisionSchema = z.looseObject({
  id,
  number: z.union([text, z.number().int().nonnegative()]).transform(String),
  name: text,
  address: z.string().nullable().optional(),
  divisionCategory: z.string(),
  countryCode: z.string(),
  prohibitedIssuance: z.boolean().nullable().optional(),
  maxWeightPlaceRecipient: z.number().nullable().optional(),
  settlement: z.looseObject({ id, name: text }),
});

export type Division = z.output<typeof divisionSchema>;

/** `201` of `POST /shipments` (spike 7a H19). */
export const createdShipmentSchema = z.looseObject({
  id: z.string().min(1).max(64),
  number: z.string().regex(/^\d{1,20}$/),
  cost: z.number().nullable().optional(),
  scheduledDeliveryDate: z.string().nullable().optional(),
});

/** A row of `GET /shipments` (spike 7a: `id`, `number`, `clientOrder`, `createdAt` ISO UTC, `totalCost`, ...). */
export const shipmentRowSchema = z.looseObject({
  id: z.string().min(1).max(64),
  number: z.string().regex(/^\d{1,20}$/),
  clientOrder: z.string().nullable().optional(),
  createdAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  totalCost: z.number().nullable().optional(),
  scheduledDeliveryDate: z.string().nullable().optional(),
});

const statusRowSchema = z.looseObject({
  number: z.string(),
  statusCode: z.union([z.number().int().nonnegative(), z.string().regex(/^\d{1,6}$/)]),
  statusDate: z.string().nullable().optional(),
});

export type StatusRow = z.output<typeof statusRowSchema>;

/**
 * `GET /shipments/tracking`: production answered `{items: [{currentStatus: {...}}]}` (an object; spike 7a rerun, H25);
 * the documentation says `{currentStatus: [...]}`. Both are read; a one-element array inside an item too.
 */
export const trackingItemsSchema = z.looseObject({
  items: z.array(
    z.looseObject({
      currentStatus: z
        .union([statusRowSchema, z.array(statusRowSchema)])
        .nullable()
        .optional(),
    }),
  ),
});

export const trackingDocumentedSchema = z.looseObject({ currentStatus: z.array(statusRowSchema) });

/** `POST /shipments/calculations` (documented; never answered 200 in the spike, H18). */
export const calculationAnswerSchema = z.looseObject({
  services: z.array(z.looseObject({ cost: z.number() })),
});
