import { MAX_QUANTITY } from "../pricing/limits.js";
import { MAX_ON_HAND, MAX_RESERVED } from "./limits.js";
import { assertValidFlags, assertValidLevel, assertValidStatus } from "./types.js";
import type {
  ReservationStatus,
  StockFlags,
  StockLevel,
  StockMovement,
  StockMovementKind,
  StockReservation,
} from "./types.js";

/*
 * Stock operations as pure decisions (ADR 0011). Each function takes the current `inventory_level` and returns the new
 * level plus what to record (a `stock_movement` row, a reservation status), or a typed refusal. The API calls them under
 * the row lock (`SELECT ... FOR UPDATE`) and writes the result in the same transaction; no function here reads the clock,
 * touches a database or mutates its arguments.
 *
 * Data errors (a quantity from a request, a reservation in the wrong state) are refusals. Corrupt stored data (a
 * negative level, an unknown reservation status, bad flags) throws a RangeError, as the money module does.
 */

export type StockRefusal =
  | "invalid_quantity"
  | "not_tracked"
  | "insufficient_stock"
  | "not_active"
  | "already_committed"
  | "level_inconsistent"
  | "no_change"
  | "negative_on_hand"
  | "below_reserved"
  | "on_hand_out_of_range"
  | "reserved_out_of_range"
  | "kind_requires_increase";

export interface StockRefused<Reason extends StockRefusal = StockRefusal> {
  readonly ok: false;
  readonly reason: Reason;
}

export interface StockDecision {
  readonly ok: true;
  readonly level: StockLevel;
  /** The journal row to append, or `null` when `on_hand` does not change (reserve, release, expire). */
  readonly movement: StockMovement | null;
  /** The status of the reservation after the operation (`active` for a new reservation). */
  readonly reservationStatus: ReservationStatus;
}

export interface CommitDecision extends StockDecision {
  readonly movement: StockMovement;
  readonly reservationStatus: "committed";
}

export type AdjustableKind = Exclude<StockMovementKind, "sale">;

export type StockAdjustment =
  | { readonly mode: "delta"; readonly delta: number; readonly kind: AdjustableKind }
  | { readonly mode: "setOnHand"; readonly onHand: number; readonly kind: AdjustableKind };

export interface AdjustmentDecision {
  readonly ok: true;
  readonly level: StockLevel;
  readonly movement: StockMovement;
}

function refuse<Reason extends StockRefusal>(reason: Reason): StockRefused<Reason> {
  return { ok: false, reason };
}

function isValidQuantity(quantity: unknown): quantity is number {
  return (
    typeof quantity === "number" &&
    Number.isInteger(quantity) &&
    quantity >= 1 &&
    quantity <= MAX_QUANTITY
  );
}

/**
 * Holds `quantity` units. Reserved never exceeds on hand unless backorder is allowed, and never exceeds `MAX_RESERVED`
 * (`reserved_out_of_range`). A variant that is not tracked has no stock to hold (`not_tracked`): the caller skips the
 * reservation.
 */
export function decideReserve(
  level: StockLevel,
  flags: StockFlags,
  quantity: number,
):
  | StockDecision
  | StockRefused<
      "invalid_quantity" | "not_tracked" | "insufficient_stock" | "reserved_out_of_range"
    > {
  assertValidLevel(level);
  assertValidFlags(flags);
  if (!isValidQuantity(quantity)) {
    return refuse("invalid_quantity");
  }
  if (!flags.trackInventory) {
    return refuse("not_tracked");
  }
  if (!flags.allowBackorder && quantity > level.onHand - level.reserved) {
    return refuse("insufficient_stock");
  }
  if (level.reserved + quantity > MAX_RESERVED) {
    return refuse("reserved_out_of_range");
  }
  return {
    ok: true,
    level: { onHand: level.onHand, reserved: level.reserved + quantity },
    movement: null,
    reservationStatus: "active",
  };
}

type ReservationRefusal =
  "invalid_quantity" | "not_active" | "already_committed" | "level_inconsistent";

/** Shared checks of release, expire and commit: only an active reservation held by the level can leave `active`. */
function checkActiveReservation(
  level: StockLevel,
  reservation: StockReservation,
): StockRefused<ReservationRefusal> | null {
  assertValidLevel(level);
  assertValidStatus(reservation.status);
  if (!isValidQuantity(reservation.quantity)) {
    return refuse("invalid_quantity");
  }
  if (reservation.status === "committed") {
    return refuse("already_committed");
  }
  if (reservation.status !== "active") {
    return refuse("not_active");
  }
  if (level.reserved < reservation.quantity) {
    return refuse("level_inconsistent");
  }
  return null;
}

function decideLeaveActive(
  level: StockLevel,
  reservation: StockReservation,
  status: "released" | "expired",
): StockDecision | StockRefused<ReservationRefusal> {
  const refusal = checkActiveReservation(level, reservation);
  if (refusal !== null) {
    return refusal;
  }
  return {
    ok: true,
    level: { onHand: level.onHand, reserved: level.reserved - reservation.quantity },
    movement: null,
    reservationStatus: status,
  };
}

/** Gives the held units back (cancelled cart or order). Lowers `reserved` only. */
export function decideRelease(
  level: StockLevel,
  reservation: StockReservation,
): StockDecision | StockRefused<ReservationRefusal> {
  return decideLeaveActive(level, reservation, "released");
}

/** Same effect as release, for a reservation whose time ran out; the status tells them apart. */
export function decideExpire(
  level: StockLevel,
  reservation: StockReservation,
): StockDecision | StockRefused<ReservationRefusal> {
  return decideLeaveActive(level, reservation, "expired");
}

/**
 * Turns an active reservation into a sale: lowers `on_hand` and `reserved` by its quantity and yields a `sale` movement
 * with a negative delta. Units reserved by backorder that are not on hand yet cannot be sold (`insufficient_stock`),
 * so `on_hand` never goes below 0.
 */
export function decideCommit(
  level: StockLevel,
  reservation: StockReservation,
): CommitDecision | StockRefused<ReservationRefusal | "insufficient_stock"> {
  const refusal = checkActiveReservation(level, reservation);
  if (refusal !== null) {
    return refusal;
  }
  if (level.onHand < reservation.quantity) {
    return refuse("insufficient_stock");
  }
  const onHand = level.onHand - reservation.quantity;
  return {
    ok: true,
    level: { onHand, reserved: level.reserved - reservation.quantity },
    movement: { kind: "sale", delta: -reservation.quantity, onHandAfter: onHand },
    reservationStatus: "committed",
  };
}

const ADJUSTABLE_KINDS: readonly AdjustableKind[] = ["receipt", "adjustment", "return"];

/**
 * An admin or system change of `on_hand` by a delta or to an absolute value. The result must be within 0 and
 * `MAX_ON_HAND`. A change that LOWERS `on_hand` may not leave it below `reserved` (release the reservations first);
 * a change that raises it is always allowed, so a partial receipt can reduce a backorder step by step. A change of zero is
 * refused because the journal never holds a zero delta. A receipt or a return must add stock. Sales go through
 * `decideCommit`, so `sale` is not an adjustable kind (RangeError). Works for untracked variants as well.
 */
export function decideAdjustment(
  level: StockLevel,
  adjustment: StockAdjustment,
): AdjustmentDecision | StockRefused {
  assertValidLevel(level);
  if (!ADJUSTABLE_KINDS.includes(adjustment.kind)) {
    throw new RangeError(`A stock adjustment can not have the kind: ${String(adjustment.kind)}`);
  }
  let delta: number;
  if (adjustment.mode === "delta") {
    if (!Number.isSafeInteger(adjustment.delta)) {
      return refuse("invalid_quantity");
    }
    delta = adjustment.delta;
  } else if (adjustment.mode === "setOnHand") {
    if (!Number.isSafeInteger(adjustment.onHand)) {
      return refuse("invalid_quantity");
    }
    delta = adjustment.onHand - level.onHand;
  } else {
    throw new RangeError(
      `Unknown stock adjustment mode: ${String((adjustment as { mode?: unknown }).mode)}`,
    );
  }

  if (delta === 0) {
    return refuse("no_change");
  }
  if (delta < 0 && adjustment.kind !== "adjustment") {
    return refuse("kind_requires_increase");
  }
  const onHand = level.onHand + delta;
  if (onHand < 0) {
    return refuse("negative_on_hand");
  }
  if (onHand > MAX_ON_HAND) {
    return refuse("on_hand_out_of_range");
  }
  if (delta < 0 && onHand < level.reserved) {
    return refuse("below_reserved");
  }
  return {
    ok: true,
    level: { onHand, reserved: level.reserved },
    movement: { kind: adjustment.kind, delta, onHandAfter: onHand },
  };
}

export type ExtendRefusal = "not_active" | "already_committed" | "invalid_expiry" | "would_shorten";

export type ExtendDecision =
  | { readonly ok: true; readonly expiresAt: Date }
  | { readonly ok: false; readonly reason: ExtendRefusal };

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function refuseExtend(reason: ExtendRefusal): ExtendDecision {
  return { ok: false, reason };
}

/**
 * Moves the expiry of an ACTIVE reservation later, for example to hold a backordered line of a paid order until stock
 * arrives (plan 2026-10-17, open question 3). It never shortens (`would_shorten`; the same time again is accepted, so a
 * retry is harmless) and changes neither the level nor the journal. Status checks come first and use the reasons of
 * release and commit; a new expiry that is not a valid Date is `invalid_expiry`. The caller decides whether an active
 * reservation whose time already passed may still be extended: there is no clock here. A corrupt stored status or expiry
 * throws a RangeError.
 */
export function decideExtend(
  reservation: { readonly status: ReservationStatus; readonly expiresAt: Date },
  newExpiresAt: Date,
): ExtendDecision {
  assertValidStatus(reservation.status);
  if (!isValidDate(reservation.expiresAt)) {
    throw new RangeError("A reservation needs a valid expiry date");
  }
  if (reservation.status === "committed") {
    return refuseExtend("already_committed");
  }
  if (reservation.status !== "active") {
    return refuseExtend("not_active");
  }
  if (!isValidDate(newExpiresAt)) {
    return refuseExtend("invalid_expiry");
  }
  if (newExpiresAt.getTime() < reservation.expiresAt.getTime()) {
    return refuseExtend("would_shorten");
  }
  return { ok: true, expiresAt: new Date(newExpiresAt.getTime()) };
}
