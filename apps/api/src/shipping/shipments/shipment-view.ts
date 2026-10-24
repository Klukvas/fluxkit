import {
  SHIPMENT_ACTORS,
  SHIPMENT_PAYERS,
  SHIPMENT_STATUSES,
  type ShipmentActor,
  type ShipmentPayer,
  type ShipmentStatus,
} from "@fluxkit/core";
import type { z } from "zod";
import type { ShipmentRow, ShipmentStatusChangeRow } from "../../orders/orders.repository.js";
import type { adminShipmentSchema, storeShipmentSchema } from "../../orders/orders.schemas.js";

/*
 * The views of a shipment (ADR 0029 decisions 5 and 10), built field by field from the rows, so a column added to
 * `shipment` later can not reach a response by accident. Neither view carries a name, a phone or carrier text: the rows
 * hold none (ADR 0029 decision 7), and the provider ref (the carrier's internal id) stays inside the API.
 */

export type StoreShipmentView = z.output<typeof storeShipmentSchema>;
/** The admin view; the same shape as core `AdminOrderShipmentView` (what `OrderReadPort` returns). */
export type AdminShipmentView = z.output<typeof adminShipmentSchema>;

/** A stored value outside the core lists is damaged data (loud), as in the order views. */
export function shipmentStatusOf(value: string): ShipmentStatus {
  if (!SHIPMENT_STATUSES.includes(value as ShipmentStatus)) {
    throw new RangeError(`The shipment has an unknown status: ${value}`);
  }
  return value as ShipmentStatus;
}

function actorOf(value: string): ShipmentActor {
  if (!SHIPMENT_ACTORS.includes(value as ShipmentActor)) {
    throw new RangeError(`The shipment journal has an unknown actor: ${value}`);
  }
  return value as ShipmentActor;
}

function payerOf(value: string): ShipmentPayer {
  if (!SHIPMENT_PAYERS.includes(value as ShipmentPayer)) {
    throw new RangeError(`The shipment has an unknown payer: ${value}`);
  }
  return value as ShipmentPayer;
}

function instant(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export function toAdminShipment(
  row: ShipmentRow,
  changes: readonly ShipmentStatusChangeRow[],
): AdminShipmentView {
  return {
    id: row.id,
    status: shipmentStatusOf(row.status),
    providerCode: row.providerCode,
    providerService: row.providerService,
    trackingNumber: row.trackingNumber,
    carrierStatusCode: row.carrierStatusCode,
    carrierStatusAt: instant(row.carrierStatusAt),
    clientReference: row.clientReference,
    declaredValue: { amount: row.declaredValueAmount, currency: row.currency },
    carrierCost:
      row.carrierCostAmount === null
        ? null
        : { amount: row.carrierCostAmount, currency: row.currency },
    payer: payerOf(row.payer),
    weightGrams: row.weightGrams,
    lengthMm: row.lengthMm,
    widthMm: row.widthMm,
    heightMm: row.heightMm,
    seats: row.seats,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    cancelledAt: instant(row.cancelledAt),
    deliveredAt: instant(row.deliveredAt),
    nextTrackAt: instant(row.nextTrackAt),
    history: changes
      .filter((change) => change.shipmentId === row.id)
      .map((change) => ({
        fromStatus: change.fromStatus === null ? null : shipmentStatusOf(change.fromStatus),
        toStatus: shipmentStatusOf(change.toStatus),
        carrierStatusCode: change.carrierStatusCode,
        actorType: actorOf(change.actorType),
        actorAdminId: change.actorAdminId,
        at: change.createdAt.toISOString(),
      })),
  };
}

/** The admin views of every shipment of a list, each with its own journal. */
export function toAdminShipments(
  rows: readonly ShipmentRow[],
  changes: readonly ShipmentStatusChangeRow[],
): AdminShipmentView[] {
  return rows.map((row) => toAdminShipment(row, changes));
}

/** The shopper's view: only shipments with a waybill number (a `pending`, `unknown` or refused one is not theirs to track). */
export function toStoreShipments(rows: readonly ShipmentRow[]): StoreShipmentView[] {
  return rows.flatMap((row) =>
    row.trackingNumber === null
      ? []
      : [
          {
            providerCode: row.providerCode,
            trackingNumber: row.trackingNumber,
            status: shipmentStatusOf(row.status),
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
            deliveredAt: instant(row.deliveredAt),
            cancelledAt: instant(row.cancelledAt),
          },
        ],
  );
}
