import type { AdminOrder, CreateAdminShipmentBody, ShipmentPayer } from "@fluxkit/api-client";
import { amountToInputText, parseMoneyInput } from "../../lib/money-input";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { checkActionText } from "./action-text";

/**
 * The create-waybill form (`docs/api/shipping.md`, `POST /admin/orders/{id}/shipments`): one parcel, typed as whole
 * numbers (grams, millimetres), the declared value as DECIMAL text converted to minor units of the order's currency with
 * the BigInt money parser (default: the order subtotal), the payer (default from the method), and the cargo description
 * for the carrier. Pure. The limits are the API's (copied: apps may not import each other); the API stays the authority.
 */

export const SHIPMENT_LIMITS = {
  weightGrams: { min: 1, max: 1_000_000 },
  dimensionMm: { min: 1, max: 10_000 },
  descriptionMax: 200,
} as const;

export type ShipmentField =
  "weightGrams" | "lengthMm" | "widthMm" | "heightMm" | "description" | "declaredValue" | "payer";

export const SHIPMENT_FIELDS: readonly ShipmentField[] = [
  "weightGrams",
  "lengthMm",
  "widthMm",
  "heightMm",
  "description",
  "declaredValue",
  "payer",
];

export interface ShipmentFormValues {
  weightGrams: string;
  lengthMm: string;
  widthMm: string;
  heightMm: string;
  description: string;
  /** Decimal text in the order's currency. */
  declaredValue: string;
  payer: ShipmentPayer;
}

/**
 * The defaults the admin starts from: the declared value is the order subtotal (the API's own default), the payer is the
 * recipient for a method the recipient pays on delivery and the sender otherwise (the API's default too). The parcel and
 * the description are the admin's to type: the shop sells anything, so there is no default size.
 */
export function shipmentFormDefaults(
  order: Pick<AdminOrder, "subtotal" | "shipping">,
  exponent: number,
): ShipmentFormValues {
  return {
    weightGrams: "",
    lengthMm: "",
    widthMm: "",
    heightMm: "",
    description: "",
    declaredValue: amountToInputText(order.subtotal.amount, exponent),
    payer: order.shipping?.payer === "recipient_on_delivery" ? "recipient" : "sender",
  };
}

export function isShipmentDirty(values: ShipmentFormValues, defaults: ShipmentFormValues): boolean {
  return SHIPMENT_FIELDS.some((field) => values[field] !== defaults[field]);
}

type WholeNumberResult = { ok: true; value: number } | { ok: false; issue: MessageDescriptor };

/** A whole number written with ASCII digits only, between `min` and `max`; the reasons have messages. */
export function parseWholeNumber(text: string, min: number, max: number): WholeNumberResult {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, issue: { key: "shipment.error.required" } };
  if (!/^[0-9]{1,9}$/.test(trimmed))
    return { ok: false, issue: { key: "shipment.error.wholeNumber" } };
  const value = Number(trimmed);
  if (value < min) return { ok: false, issue: { key: "shipment.error.tooSmall", values: { min } } };
  if (value > max) return { ok: false, issue: { key: "shipment.error.tooBig", values: { max } } };
  return { ok: true, value };
}

export type ShipmentIssues = Partial<Record<ShipmentField, MessageDescriptor>>;
export type ShipmentPlan =
  { ok: true; body: CreateAdminShipmentBody } | { ok: false; issues: ShipmentIssues };

/** The request body for the typed values, or the issues by field. Nothing is sent when there is an issue. */
export function planShipment(
  values: ShipmentFormValues,
  order: Pick<AdminOrder, "currency">,
  exponent: number,
): ShipmentPlan {
  const issues: ShipmentIssues = {};
  const parcel = (field: "weightGrams" | "lengthMm" | "widthMm" | "heightMm") => {
    const limit =
      field === "weightGrams" ? SHIPMENT_LIMITS.weightGrams : SHIPMENT_LIMITS.dimensionMm;
    const parsed = parseWholeNumber(values[field], limit.min, limit.max);
    if (!parsed.ok) {
      issues[field] = parsed.issue;
      return 0;
    }
    return parsed.value;
  };
  const weightGrams = parcel("weightGrams");
  const lengthMm = parcel("lengthMm");
  const widthMm = parcel("widthMm");
  const heightMm = parcel("heightMm");

  const description = checkActionText(values.description, SHIPMENT_LIMITS.descriptionMax);
  if (!description.ok) issues.description = { key: `order.field.${description.issue}` };

  const declared = parseMoneyInput(values.declaredValue, exponent);
  if (!declared.ok)
    issues.declaredValue = {
      key: `shipment.money.${declared.reason}`,
      values: { decimals: exponent },
    };

  if (!description.ok || !declared.ok || Object.keys(issues).length > 0)
    return { ok: false, issues };
  return {
    ok: true,
    body: {
      weightGrams,
      lengthMm,
      widthMm,
      heightMm,
      description: description.value,
      declaredValue: { amount: declared.amount, currency: order.currency },
      payer: values.payer,
    },
  };
}
