import { ORDER_NUMBER_PATTERN } from "../orders/number.js";
import { SHIPMENT_STATUSES } from "./shipment-status.js";
import type { ShipmentStatus } from "./shipment-status.js";

/*
 * Shipment domain events (ADR 0029 decision 12, ADR 0018). Names and the payload builder only; the API writes them into
 * the `domain_event` outbox in the transaction of the change (plan step 8). Aggregate = the shipment id. Payloads carry
 * ids, the order number and the normalized status only: never a tracking number, a phone or a name.
 */

export const SHIPMENT_EVENT_TYPES = Object.freeze([
  "shipment.created",
  "shipment.status_changed",
  "shipment.cancelled",
] as const);

export type ShipmentEventType = (typeof SHIPMENT_EVENT_TYPES)[number];

/**
 * The event for a shipment that has just entered `status`: `shipment.created` when the carrier accepted the waybill,
 * `shipment.cancelled` when it is cancelled, `shipment.status_changed` for every other status. Entering `pending` (the row
 * written before the carrier call) emits nothing: `null`. An unknown status is a bug (RangeError).
 */
export function shipmentEventTypeFor(status: ShipmentStatus): ShipmentEventType | null {
  if (!SHIPMENT_STATUSES.includes(status)) {
    throw new RangeError(`Unknown shipment status: ${String(status)}`);
  }
  switch (status) {
    case "pending":
      return null;
    case "created":
      return "shipment.created";
    case "cancelled":
      return "shipment.cancelled";
    default:
      return "shipment.status_changed";
  }
}

export interface ShipmentEventPayload {
  readonly shipmentId: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: ShipmentStatus;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The stored payload of a shipment event, built field by field so nothing else a caller passes (a tracking number, a
 * phone) can reach the outbox; a malformed value is a bug (RangeError).
 */
export function buildShipmentEventPayload(input: ShipmentEventPayload): ShipmentEventPayload {
  if (typeof input.shipmentId !== "string" || !UUID.test(input.shipmentId)) {
    throw new RangeError("A shipment event needs the shipment id (uuid)");
  }
  if (typeof input.orderId !== "string" || !UUID.test(input.orderId)) {
    throw new RangeError("A shipment event needs the order id (uuid)");
  }
  if (typeof input.orderNumber !== "string" || !ORDER_NUMBER_PATTERN.test(input.orderNumber)) {
    throw new RangeError("A shipment event needs the order number");
  }
  if (!SHIPMENT_STATUSES.includes(input.status)) {
    throw new RangeError(`Unknown shipment status: ${String(input.status)}`);
  }
  return Object.freeze({
    shipmentId: input.shipmentId,
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    status: input.status,
  });
}
