/*
 * The shipment status machine (ADR 0029 decisions 7 and 10). Normalized statuses: a provider maps its own codes to
 * them; the raw carrier code is kept beside the status, never the carrier's text. The transition table is data, like
 * `ORDER_TRANSITIONS`; `decideShipmentTransition` is the only way a status changes. A shipment never changes the order
 * status or the stock. The table is a v1 proposal: the Nova Poshta check (plan step 7a) may refine it.
 * An unknown status or actor is corrupt data or a bug (RangeError).
 */

export const SHIPMENT_STATUSES = Object.freeze([
  /** The row is written, the carrier has not answered yet (written BEFORE the carrier call). */
  "pending",
  /** The carrier call timed out: whether a waybill exists is not known; `reconcile` asks the carrier. */
  "unknown",
  /** The carrier accepted the waybill. */
  "created",
  "in_transit",
  /** At the branch or the locker, waiting for the recipient. */
  "arrived",
  "delivered",
  "returning",
  "returned",
  "cancelled",
  /** The carrier refused the waybill, or `reconcile` found none. */
  "failed",
] as const);

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/** The statuses a provider may report from tracking (`TrackingUpdate.status`). */
export const CARRIER_REPORTED_SHIPMENT_STATUSES = Object.freeze([
  "created",
  "in_transit",
  "arrived",
  "delivered",
  "returning",
  "returned",
  "cancelled",
] as const satisfies readonly ShipmentStatus[]);

export type CarrierReportedShipmentStatus = (typeof CARRIER_REPORTED_SHIPMENT_STATUSES)[number];

/** `admin` acts through an admin route (create, cancel, refresh, reconcile); `system` is the tracking job. */
export const SHIPMENT_ACTORS = Object.freeze(["admin", "system"] as const);

export type ShipmentActor = (typeof SHIPMENT_ACTORS)[number];

/** Who pays the carrier for a waybill (`shipment.payer`). */
export const SHIPMENT_PAYERS = Object.freeze(["sender", "recipient"] as const);

export type ShipmentPayer = (typeof SHIPMENT_PAYERS)[number];

/** Statuses that do not count as the order's one active shipment (the partial unique index; owner answer 9). */
export const INACTIVE_SHIPMENT_STATUSES = Object.freeze([
  "cancelled",
  "failed",
] as const satisfies readonly ShipmentStatus[]);

export interface ShipmentTransitionRule {
  /** `null` is the creation of the shipment row. */
  readonly from: ShipmentStatus | null;
  readonly to: ShipmentStatus;
  readonly actors: readonly ShipmentActor[];
}

const BOTH: readonly ShipmentActor[] = ["admin", "system"];

function rule(
  from: ShipmentStatus | null,
  to: ShipmentStatus,
  actors: readonly ShipmentActor[],
): ShipmentTransitionRule {
  return Object.freeze({ from, to, actors: Object.freeze([...actors]) });
}

/**
 * Every allowed transition; everything else is refused. Only an admin creates a shipment. A tracking poll may skip
 * statuses (a parcel can be delivered between two polls), so a later status is reachable directly. `created ->
 * cancelled` is the waybill cancelled by the admin, or deleted at the carrier and reported by tracking. `delivered`,
 * `returned`, `cancelled` and `failed` have no way out.
 */
export const SHIPMENT_TRANSITIONS: readonly ShipmentTransitionRule[] = Object.freeze([
  rule(null, "pending", ["admin"]),
  rule("pending", "created", BOTH),
  rule("pending", "unknown", BOTH),
  rule("pending", "failed", BOTH),
  rule("unknown", "created", BOTH),
  rule("unknown", "failed", BOTH),
  rule("created", "in_transit", BOTH),
  rule("created", "arrived", BOTH),
  rule("created", "delivered", BOTH),
  rule("created", "returning", BOTH),
  rule("created", "cancelled", BOTH),
  rule("in_transit", "arrived", BOTH),
  rule("in_transit", "delivered", BOTH),
  rule("in_transit", "returning", BOTH),
  rule("arrived", "in_transit", BOTH),
  rule("arrived", "delivered", BOTH),
  rule("arrived", "returning", BOTH),
  rule("returning", "returned", BOTH),
]);

export type ShipmentTransitionDecision =
  | { readonly ok: true; readonly from: ShipmentStatus | null; readonly to: ShipmentStatus }
  | { readonly ok: false; readonly reason: "invalid_transition" | "not_allowed_for_actor" };

function assertStatus(value: unknown): asserts value is ShipmentStatus {
  if (!SHIPMENT_STATUSES.includes(value as ShipmentStatus)) {
    throw new RangeError(`Unknown shipment status: ${String(value)}`);
  }
}

function assertActor(value: unknown): asserts value is ShipmentActor {
  if (!SHIPMENT_ACTORS.includes(value as ShipmentActor)) {
    throw new RangeError(`Unknown shipment actor: ${String(value)}`);
  }
}

/**
 * `from` is `null` for the creation of the row. A pair outside the table (the same status twice included: a carrier code
 * that changes without a status change is not a transition) is `invalid_transition`, whoever asks.
 */
export function decideShipmentTransition(
  from: ShipmentStatus | null,
  to: ShipmentStatus,
  actor: ShipmentActor,
): ShipmentTransitionDecision {
  if (from !== null) {
    assertStatus(from);
  }
  assertStatus(to);
  assertActor(actor);
  const found = SHIPMENT_TRANSITIONS.find((entry) => entry.from === from && entry.to === to);
  if (found === undefined) {
    return Object.freeze({ ok: false as const, reason: "invalid_transition" as const });
  }
  if (!found.actors.includes(actor)) {
    return Object.freeze({ ok: false as const, reason: "not_allowed_for_actor" as const });
  }
  return Object.freeze({ ok: true as const, from, to });
}

/** No transition leaves a terminal status. */
export function isTerminalShipmentStatus(status: ShipmentStatus): boolean {
  assertStatus(status);
  return !SHIPMENT_TRANSITIONS.some((entry) => entry.from === status);
}

/** Whether the shipment counts as the order's one active shipment (not `cancelled`, not `failed`). */
export function isActiveShipmentStatus(status: ShipmentStatus): boolean {
  assertStatus(status);
  return !(INACTIVE_SHIPMENT_STATUSES as readonly ShipmentStatus[]).includes(status);
}

/** Whether the tracking job polls the carrier for it: a waybill exists and the status is not terminal. */
export function isTrackedShipmentStatus(status: ShipmentStatus): boolean {
  assertStatus(status);
  return status !== "pending" && status !== "unknown" && !isTerminalShipmentStatus(status);
}
