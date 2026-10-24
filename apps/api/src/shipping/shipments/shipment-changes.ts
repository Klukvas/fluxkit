import { Inject, Injectable } from "@nestjs/common";
import {
  buildShipmentEventPayload,
  decideShipmentTransition,
  shipmentEventTypeFor,
  type ShipmentStatus,
} from "@fluxkit/core";
import type { Transaction } from "../../common/transaction.js";
import { OrdersRepository, type ShipmentRow } from "../../orders/orders.repository.js";
import { shipmentStatusOf } from "./shipment-view.js";
import {
  ShipmentsRepository,
  type NewShipment,
  type ShipmentUpdate,
} from "./shipments.repository.js";

/** Who changes a shipment: an admin through a route (recorded in the journal), or the tracking job. */
export type ShipmentActorRef =
  { readonly type: "admin"; readonly adminId: string | null } | { readonly type: "system" };

export type ShipmentChangeResult =
  | { readonly ok: true; readonly row: ShipmentRow }
  | { readonly ok: false; readonly reason: "invalid_transition" | "not_allowed_for_actor" };

/**
 * The ONLY place a shipment row is created or changes status (ADR 0029 decisions 7, 10 and 12). Every status comes from
 * core `decideShipmentTransition`; each change writes the row, its `shipment_status_change` row and, except for the
 * creation as `pending`, its `shipment.*` event (payload from core `buildShipmentEventPayload`), all in the CALLER's
 * transaction, so the three commit or roll back together. The caller holds the shipment row `FOR UPDATE` (a change) or
 * the order row (the creation) and never calls a provider inside that transaction.
 */
@Injectable()
export class ShipmentChanges {
  constructor(
    @Inject(ShipmentsRepository) private readonly shipments: ShipmentsRepository,
    @Inject(OrdersRepository) private readonly orders: OrdersRepository,
  ) {}

  /** Inserts a new shipment as `pending` (`null -> pending`, admins only) with its first journal row; no event yet. */
  async create(
    tx: Transaction,
    values: Omit<NewShipment, "status">,
    actor: ShipmentActorRef,
  ): Promise<ShipmentRow> {
    const decision = decideShipmentTransition(null, "pending", actor.type);
    if (!decision.ok) {
      throw new RangeError(`A shipment can not be created by ${actor.type}: ${decision.reason}`);
    }
    const row = await this.shipments.insert(tx, { ...values, status: "pending" });
    await this.journal(tx, row, null, "pending", actor, null);
    return row;
  }

  /**
   * Moves a LOCKED shipment from its current status to `to`, with the extra columns (`columns`) the new status brings
   * (a waybill number, a cancel time). A refusal of the state machine changes nothing.
   */
  async transition(
    tx: Transaction,
    current: ShipmentRow,
    to: ShipmentStatus,
    actor: ShipmentActorRef,
    options: {
      readonly now: Date;
      readonly columns?: ShipmentUpdate;
      readonly carrierStatusCode?: string | null;
    },
  ): Promise<ShipmentChangeResult> {
    const from = shipmentStatusOf(current.status);
    const decision = decideShipmentTransition(from, to, actor.type);
    if (!decision.ok) {
      return { ok: false, reason: decision.reason };
    }
    const row = await this.shipments.update(tx, current.id, {
      ...options.columns,
      status: to,
      updatedAt: options.now,
      ...(to === "cancelled" ? { cancelledAt: options.now } : {}),
      ...(to === "delivered" ? { deliveredAt: options.now } : {}),
    });
    await this.journal(tx, row, from, to, actor, options.carrierStatusCode ?? null);
    const type = shipmentEventTypeFor(to);
    if (type === null) {
      throw new RangeError(`Entering ${to} is not a change of an existing shipment`);
    }
    await this.orders.insertEvent(tx, {
      type,
      aggregateId: row.id,
      payload: buildShipmentEventPayload({
        shipmentId: row.id,
        orderId: row.orderId,
        // The client reference IS our order number (CHECK `shipment_client_reference_check`).
        orderNumber: row.clientReference,
        status: to,
      }),
    });
    return { ok: true, row };
  }

  private async journal(
    tx: Transaction,
    row: ShipmentRow,
    from: ShipmentStatus | null,
    to: ShipmentStatus,
    actor: ShipmentActorRef,
    carrierStatusCode: string | null,
  ): Promise<void> {
    await this.shipments.insertStatusChange(tx, {
      shipmentId: row.id,
      fromStatus: from,
      toStatus: to,
      carrierStatusCode,
      actorType: actor.type,
      actorAdminId: actor.type === "admin" ? actor.adminId : null,
    });
  }
}
