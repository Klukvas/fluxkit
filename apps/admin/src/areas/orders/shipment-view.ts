import type {
  AdminOrder,
  AdminOrderShipping,
  AdminShipment,
  AdminShipmentHistoryEntry,
  ShipmentStatus,
} from "@fluxkit/api-client";
import type { StatusTone } from "@fluxkit/ui";
import { actorLabel } from "../../lib/actor-label";
import { canRun } from "../../permissions";
import type { HistoryActor } from "./order-view";

/**
 * How the order detail presents and gates the shipments of an order (shipping plan step 11; `docs/api/shipping.md`,
 * "Shipments (admin)"). Pure. The gates are HINTS: the API decides under its row locks and its refusal is shown. They
 * mirror core's status table and the API's rules (compared in `shipment-view.spec.ts`); each action needs the permission
 * of its own operation, so a session without `orders.write` is offered no action and no create form.
 */

export const SHIPMENT_STATUS_LIST = [
  "pending",
  "unknown",
  "created",
  "in_transit",
  "arrived",
  "delivered",
  "returning",
  "returned",
  "cancelled",
  "failed",
] as const satisfies readonly ShipmentStatus[];

export function shipmentStatusLabelKey(status: ShipmentStatus): string {
  return `shipment.status.${status}`;
}

/** The badge of a status: the text says it, the tone is a hint only. */
export const SHIPMENT_STATUS_TONES: Record<ShipmentStatus, StatusTone> = {
  pending: "warning",
  unknown: "warning",
  created: "success",
  in_transit: "neutral",
  arrived: "neutral",
  delivered: "success",
  returning: "warning",
  returned: "neutral",
  cancelled: "neutral",
  failed: "danger",
};

/** Statuses that do not count as the order's one active shipment (core's `INACTIVE_SHIPMENT_STATUSES`). */
const INACTIVE: readonly ShipmentStatus[] = ["cancelled", "failed"];

/** The order's active shipment (one at most; an `unknown` or a `pending` one included), or `null`. */
export function activeShipment(shipments: readonly AdminShipment[]): AdminShipment | null {
  return shipments.find((shipment) => !INACTIVE.includes(shipment.status)) ?? null;
}

/** A pending shipment older than this is left by a crash and can be settled with the carrier (the API: 2 minutes). */
export const STALE_PENDING_MS = 2 * 60_000;

export const SHIPMENT_ACTIONS = ["refresh", "cancel", "label", "reconcile"] as const;
export type ShipmentAction = (typeof SHIPMENT_ACTIONS)[number];

/** The operation behind each action: its permission decides whether the session is offered it. */
export const SHIPMENT_ACTION_OPERATIONS = {
  refresh: "refreshShipment",
  cancel: "cancelShipment",
  label: "getShipmentLabel",
  reconcile: "reconcileShipment",
} as const;

/** The statuses that have a waybill at the carrier and are not over: tracking can still change them. */
const TRACKED: readonly ShipmentStatus[] = ["created", "in_transit", "arrived", "returning"];
/** The statuses with a waybill whose label can be printed (the API: `label_not_available` for the others). */
const HAS_WAYBILL: readonly ShipmentStatus[] = [
  "created",
  "in_transit",
  "arrived",
  "delivered",
  "returning",
  "returned",
];

/** The actions to offer for one shipment, in display order. `now` is the clock, passed in so the rule is testable. */
export function offeredShipmentActions(
  shipment: Pick<AdminShipment, "status" | "createdAt">,
  permissions: readonly string[] | null,
  now: Date,
): ShipmentAction[] {
  const stalePending =
    shipment.status === "pending" &&
    now.getTime() - new Date(shipment.createdAt).getTime() >= STALE_PENDING_MS;
  const wanted: Record<ShipmentAction, boolean> = {
    reconcile: shipment.status === "unknown" || stalePending,
    label: HAS_WAYBILL.includes(shipment.status),
    refresh: TRACKED.includes(shipment.status),
    cancel: shipment.status === "created",
  };
  return SHIPMENT_ACTIONS.filter(
    (action) => wanted[action] && canRun(permissions, SHIPMENT_ACTION_OPERATIONS[action]),
  );
}

/**
 * What the create-waybill part of the panel shows:
 * - `hidden`: the session may not write orders (it only reads);
 * - `no_carrier`: the order has no carrier delivery (no snapshot, or a method without a provider);
 * - `exists`: an active shipment already exists (an `unknown` one included: never a second create);
 * - `not_paid`: the form is shown but off until the order is paid (only a `paid` order ships);
 * - `ready`: the form is on.
 */
export type CreateGate =
  | { kind: "hidden" }
  | { kind: "no_carrier" }
  | { kind: "exists"; shipment: AdminShipment }
  | { kind: "not_paid"; status: AdminOrder["status"] }
  | { kind: "ready" };

export function createGate(
  order: Pick<AdminOrder, "status" | "shipping" | "shipments">,
  permissions: readonly string[] | null,
): CreateGate {
  if (!canRun(permissions, "createShipment")) return { kind: "hidden" };
  if (order.shipping === null || order.shipping.providerCode === null)
    return { kind: "no_carrier" };
  const active = activeShipment(order.shipments);
  if (active !== null) return { kind: "exists", shipment: active };
  if (order.status !== "paid") return { kind: "not_paid", status: order.status };
  return { kind: "ready" };
}

/** The statuses for which the form is shown at all (a fulfilled, cancelled or expired order is past shipping). */
export function showsCreateForm(gate: CreateGate): boolean {
  return gate.kind === "ready" || (gate.kind === "not_paid" && gate.status === "awaiting_payment");
}

export function shipmentActor(
  entry: Pick<AdminShipmentHistoryEntry, "actorType" | "actorAdminId">,
  meId: string,
  emails: ReadonlyMap<string, string> | null,
): HistoryActor {
  if (entry.actorType === "system") return { kind: "system" };
  return entry.actorAdminId === null
    ? { kind: "removedAdmin" }
    : actorLabel(entry.actorAdminId, meId, emails);
}

export function payerLabelKey(payer: AdminOrderShipping["payer"]): string {
  return `shipment.snapshot.payer.${payer}`;
}
