import { CURRENCY_CODES, MAX_AMOUNT, MAX_LINE_QUANTITY, ORDER_NUMBER_PATTERN } from "@fluxkit/core";
import { z } from "zod";

/*
 * The frozen variables of the order and shipment mails (ADR 0031 decision 5, plan 6.3): ids, the order number, small
 * structured data. Money is minor units plus the currency code and is formatted at render time; texts are the ones the
 * order's snapshot holds, resolved for the order's locale when the mail is enqueued and cut to a bounded length.
 * Never a token, a link, a rendered body, a phone or a street address: the guest link is derived at render time.
 */

/** Product and variant titles, the method title and a pickup point description are cut to this many code points. */
export const ORDER_MAIL_TEXT_MAX_CODE_POINTS = 100;

/** Lines printed in the mail; the rest is a count (`moreLines`), so the variables stay far below the 16 KiB cap. */
export const ORDER_MAIL_MAX_LINES = 12;

export const orderNumberSchema = z.string().regex(ORDER_NUMBER_PATTERN);

/** A text kept by `boundedOrderMailText`: at most 100 code points plus an ellipsis (UTF-16 units: twice that). */
const textSchema = z
  .string()
  .min(1)
  .max(ORDER_MAIL_TEXT_MAX_CODE_POINTS * 2 + 2);

export const currencySchema = z.enum(CURRENCY_CODES as [string, ...string[]]);

export const minorUnitsSchema = z.number().int().min(0).max(MAX_AMOUNT);

export const orderLineSchema = z
  .object({
    title: textSchema,
    variantTitle: textSchema.nullable(),
    quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
    lineTotal: minorUnitsSchema,
  })
  .strict();

export const pickupPointSchema = z
  .object({ number: textSchema, city: textSchema, description: textSchema })
  .strict();

export const deliverySchema = z
  .object({
    methodTitle: textSchema.nullable(),
    pickupPoint: pickupPointSchema.nullable(),
    /** The city of the delivery address (an address method); never the street or the recipient. */
    city: textSchema.nullable(),
  })
  .strict();

export const orderPlacedVariablesSchema = z
  .object({
    orderNumber: orderNumberSchema,
    currency: currencySchema,
    lines: z.array(orderLineSchema).min(1).max(ORDER_MAIL_MAX_LINES),
    moreLines: z.number().int().min(0),
    subtotal: minorUnitsSchema,
    shipping: minorUnitsSchema,
    discount: minorUnitsSchema,
    total: minorUnitsSchema,
    delivery: deliverySchema,
    /** `expires_at` (ISO 8601 UTC) while the order awaits payment, else `null`. */
    payBefore: z.iso.datetime().nullable(),
  })
  .strict();

export const orderPaidVariablesSchema = z
  .object({ orderNumber: orderNumberSchema, currency: currencySchema, total: minorUnitsSchema })
  .strict();

export const orderClosedVariablesSchema = z.object({ orderNumber: orderNumberSchema }).strict();

export const shipmentCreatedVariablesSchema = z
  .object({
    orderNumber: orderNumberSchema,
    /** The shipping method's title of the order snapshot (the carrier's name as the shop shows it), or `null`. */
    carrierTitle: textSchema.nullable(),
    trackingNumber: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  })
  .strict();

export type OrderPlacedVariables = z.infer<typeof orderPlacedVariablesSchema>;
export type OrderPaidVariables = z.infer<typeof orderPaidVariablesSchema>;
export type OrderClosedVariables = z.infer<typeof orderClosedVariablesSchema>;
export type ShipmentCreatedVariables = z.infer<typeof shipmentCreatedVariablesSchema>;

/** `text` cut to `ORDER_MAIL_TEXT_MAX_CODE_POINTS` code points (never inside a surrogate pair), `…` marking the cut. */
export function boundedOrderMailText(text: string): string {
  const points = [...text];
  return points.length <= ORDER_MAIL_TEXT_MAX_CODE_POINTS
    ? text
    : `${points.slice(0, ORDER_MAIL_TEXT_MAX_CODE_POINTS).join("")}…`;
}

/** Sample variables of the placed mail (startup render, admin preview). */
export const ORDER_PLACED_SAMPLE: OrderPlacedVariables = Object.freeze({
  orderNumber: "7K3M-9QX2",
  currency: "UAH",
  lines: Object.freeze([
    Object.freeze({
      title: "Sample product",
      variantTitle: "Sample variant",
      quantity: 2,
      lineTotal: 200_000,
    }),
    Object.freeze({
      title: "Another sample product",
      variantTitle: null,
      quantity: 1,
      lineTotal: 50_000,
    }),
  ]) as OrderPlacedVariables["lines"],
  moreLines: 0,
  subtotal: 250_000,
  shipping: 8_000,
  discount: 10_000,
  total: 248_000,
  delivery: Object.freeze({
    methodTitle: "Sample delivery",
    pickupPoint: Object.freeze({
      number: "12",
      city: "Sample city",
      description: "Sample pickup point, sample street 1",
    }),
    city: null,
  }),
  payBefore: "2030-01-01T12:00:00.000Z",
});
