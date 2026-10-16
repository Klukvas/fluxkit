/*
 * Shapes and input guards shared by the inventory rules. Bad data from callers (a quantity typed by an admin) is a
 * typed refusal in `decisions.ts`; corrupt stored data (a negative level, a non-boolean flag) is a bug or a damaged
 * database, so these guards throw a RangeError, as the money module does for misconfiguration.
 */

export interface StockFlags {
  readonly trackInventory: boolean;
  readonly allowBackorder: boolean;
}

/** One `inventory_level` row (variant and location). */
export interface StockLevel {
  readonly onHand: number;
  readonly reserved: number;
}

export type ReservationStatus = "active" | "committed" | "released" | "expired";

export const RESERVATION_STATUSES: readonly ReservationStatus[] = Object.freeze([
  "active",
  "committed",
  "released",
  "expired",
]);

export interface StockReservation {
  readonly quantity: number;
  readonly status: ReservationStatus;
}

export type StockMovementKind = "receipt" | "adjustment" | "sale" | "return";

/** The `stock_movement` row to append in the same transaction as the new level. */
export interface StockMovement {
  readonly kind: StockMovementKind;
  /** Never 0. */
  readonly delta: number;
  readonly onHandAfter: number;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function assertValidFlags(flags: StockFlags): void {
  if (
    typeof flags !== "object" ||
    flags === null ||
    typeof flags.trackInventory !== "boolean" ||
    typeof flags.allowBackorder !== "boolean"
  ) {
    throw new RangeError(
      "Stock flags must be { trackInventory: boolean, allowBackorder: boolean }",
    );
  }
}

export function assertValidLevel(level: StockLevel): void {
  if (
    typeof level !== "object" ||
    level === null ||
    !isNonNegativeInteger(level.onHand) ||
    !isNonNegativeInteger(level.reserved)
  ) {
    throw new RangeError("A stock level needs non-negative integer onHand and reserved");
  }
}

export function assertValidStatus(status: unknown): asserts status is ReservationStatus {
  if (!RESERVATION_STATUSES.includes(status as ReservationStatus)) {
    throw new RangeError(`Unknown reservation status: ${String(status)}`);
  }
}
