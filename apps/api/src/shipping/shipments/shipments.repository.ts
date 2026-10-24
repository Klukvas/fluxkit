import { Injectable } from "@nestjs/common";
import { and, asc, eq, gt, inArray, isNotNull, lte, notInArray, or, sql } from "drizzle-orm";
import { INACTIVE_SHIPMENT_STATUSES, type ShipmentStatus } from "@fluxkit/core";
import type { DbExecutor, Transaction } from "../../common/transaction.js";
import {
  salesOrder,
  shipment,
  shipmentStatusChange,
  shippingProviderSetting,
} from "../../database/schema/index.js";
import type { ShipmentRow } from "../../orders/orders.repository.js";

export type NewShipment = typeof shipment.$inferInsert;
export type NewShipmentStatusChange = typeof shipmentStatusChange.$inferInsert;
export type ShipmentUpdate = Partial<
  Pick<
    NewShipment,
    | "status"
    | "carrierStatusCode"
    | "carrierStatusAt"
    | "trackingNumber"
    | "providerRef"
    | "carrierCostAmount"
    | "cancelledAt"
    | "deliveredAt"
    | "nextTrackAt"
    | "trackingAttempts"
    | "updatedAt"
  >
>;

/** Where the previous page of the tracking job stopped: `(next_track_at, id)` of its last row. */
export interface TrackingCursor {
  readonly nextTrackAt: Date;
  readonly id: string;
}

/** A shipment due for a poll, with the order's phone the carrier may need to answer in full (never logged). */
export interface DueShipment {
  readonly id: string;
  readonly providerCode: string;
  readonly trackingNumber: string;
  readonly nextTrackAt: Date;
  readonly phone: string;
}

/** Statuses the tracking job polls (`isTrackedShipmentStatus`): a waybill exists and the status is not terminal. */
export const TRACKED_STATUSES = ["created", "in_transit", "arrived", "returning"] as const;
/** The terminal statuses, repeated in the query so the partial index `shipment_next_track_at_idx` applies. */
const TERMINAL_STATUSES = ["delivered", "returned", "cancelled", "failed"] as const;

/**
 * Reads and writes of `shipment` and `shipment_status_change` (ADR 0029 decision 7). Every write takes the caller's
 * transaction; a status change is never written here without its journal row and its event (`ShipmentChanges`). The
 * order-side reads (the views) are in `OrdersRepository`.
 */
@Injectable()
export class ShipmentsRepository {
  async insert(tx: Transaction, values: NewShipment): Promise<ShipmentRow> {
    const [row] = await tx.insert(shipment).values(values).returning();
    if (row === undefined) {
      throw new Error("Inserting a shipment returned no row");
    }
    return row;
  }

  async insertStatusChange(tx: Transaction, values: NewShipmentStatusChange): Promise<void> {
    await tx.insert(shipmentStatusChange).values(values);
  }

  async update(tx: Transaction, id: string, values: ShipmentUpdate): Promise<ShipmentRow> {
    const [row] = await tx.update(shipment).set(values).where(eq(shipment.id, id)).returning();
    if (row === undefined) {
      throw new Error("Updating a shipment found no row");
    }
    return row;
  }

  /** The shipment of THAT order (another order's shipment id is as absent as an unknown one). */
  async find(
    db: DbExecutor,
    orderId: string,
    shipmentId: string,
  ): Promise<ShipmentRow | undefined> {
    const [row] = await db
      .select()
      .from(shipment)
      .where(and(eq(shipment.id, shipmentId), eq(shipment.orderId, orderId)));
    return row;
  }

  /** The shipment row locked until the transaction ends (the order row is never locked by a shipment change). */
  async lock(tx: Transaction, shipmentId: string): Promise<ShipmentRow | undefined> {
    const [row] = await tx.select().from(shipment).where(eq(shipment.id, shipmentId)).for("update");
    return row;
  }

  /** The order's one shipment that is not cancelled and not failed, if any (the partial unique index's rule). */
  async findActive(db: DbExecutor, orderId: string): Promise<ShipmentRow | undefined> {
    const [row] = await db
      .select()
      .from(shipment)
      .where(
        and(
          eq(shipment.orderId, orderId),
          notInArray(shipment.status, [...INACTIVE_SHIPMENT_STATUSES]),
        ),
      );
    return row;
  }

  /** The non-secret settings of a provider, `{}` when none were saved. */
  async providerSettings(db: DbExecutor, providerCode: string): Promise<Record<string, unknown>> {
    const [row] = await db
      .select({ settings: shippingProviderSetting.settings })
      .from(shippingProviderSetting)
      .where(eq(shippingProviderSetting.providerCode, providerCode));
    return (row?.settings ?? {}) as Record<string, unknown>;
  }

  /**
   * One page of the tracking job: polled statuses, a waybill number, `next_track_at <= now`, a provider of `providerCodes`,
   * after `cursor`, in `(next_track_at, id)` order. No lock: each shipment is locked by its own short transaction after the
   * carrier answered. The phone is the order's contact phone (the recipient's own phone when the address carries one).
   */
  async listDue(
    db: DbExecutor,
    input: {
      readonly now: Date;
      readonly providerCodes: readonly string[];
      readonly after: TrackingCursor | undefined;
      readonly limit: number;
    },
  ): Promise<DueShipment[]> {
    if (input.providerCodes.length === 0) {
      return [];
    }
    const after =
      input.after === undefined
        ? undefined
        : or(
            gt(shipment.nextTrackAt, input.after.nextTrackAt),
            and(eq(shipment.nextTrackAt, input.after.nextTrackAt), gt(shipment.id, input.after.id)),
          );
    const rows = await db
      .select({
        id: shipment.id,
        providerCode: shipment.providerCode,
        trackingNumber: shipment.trackingNumber,
        nextTrackAt: shipment.nextTrackAt,
        phone: sql<string>`coalesce(${salesOrder.shippingAddress} ->> 'recipientPhone', ${salesOrder.phone})`,
      })
      .from(shipment)
      .innerJoin(salesOrder, eq(salesOrder.id, shipment.orderId))
      .where(
        and(
          notInArray(shipment.status, [...TERMINAL_STATUSES]),
          inArray(shipment.status, [...TRACKED_STATUSES] as ShipmentStatus[]),
          lte(shipment.nextTrackAt, input.now),
          isNotNull(shipment.trackingNumber),
          inArray(shipment.providerCode, [...input.providerCodes]),
          after,
        ),
      )
      .orderBy(asc(shipment.nextTrackAt), asc(shipment.id))
      .limit(input.limit);
    return rows.map((row) => {
      if (row.trackingNumber === null || row.nextTrackAt === null) {
        throw new Error("A due shipment without a waybill number or a poll time");
      }
      return {
        id: row.id,
        providerCode: row.providerCode,
        trackingNumber: row.trackingNumber,
        nextTrackAt: row.nextTrackAt,
        phone: row.phone,
      };
    });
  }
}
