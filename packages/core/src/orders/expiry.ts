/*
 * Expiry and access times (plan 2026-10-17, Reservation TTL and order expiry; Guest access). Pure date arithmetic in
 * UTC milliseconds: `now` is always a parameter, nothing here reads the clock. The lengths come from configuration
 * (`ORDER_PAYMENT_TTL_MINUTES`, `ORDER_GUEST_ACCESS_DAYS`), so a value outside its range is a misconfiguration and throws a
 * RangeError, as does an invalid Date.
 */

/** Minutes an order waits for payment. The default is 30. */
export const ORDER_PAYMENT_TTL_MINUTES = Object.freeze({ min: 5, max: 1440, default: 30 });

/**
 * A reservation outlives its order by this long, so the order job always expires the order and releases its
 * reservations before the generic reservation sweep could touch them; the sweep only cleans orphans.
 */
export const RESERVATION_GRACE_MINUTES = 10;

/** Days a guest may open an order with its access token. The default is 90. */
export const GUEST_ACCESS_DAYS = Object.freeze({ min: 1, max: 3650, default: 90 });

const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_DAY = 24 * 60 * MILLISECONDS_PER_MINUTE;

function assertDate(value: unknown, name: string): asserts value is Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new RangeError(`${name} must be a valid Date`);
  }
}

function assertInRange(value: unknown, name: string, range: { min: number; max: number }): void {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < range.min ||
    value > range.max
  ) {
    throw new RangeError(
      `${name} must be an integer from ${String(range.min)} to ${String(range.max)}`,
    );
  }
}

function shifted(from: Date, milliseconds: number): Date {
  const result = new Date(from.getTime() + milliseconds);
  if (!Number.isFinite(result.getTime())) {
    throw new RangeError("The date is outside the range JavaScript can represent");
  }
  return result;
}

/** The moment an order placed at `placedAt` expires (`expires_at <= now` means expired). */
export function orderExpiresAt(placedAt: Date, ttlMinutes: number): Date {
  assertDate(placedAt, "placedAt");
  assertInRange(ttlMinutes, "ttlMinutes", ORDER_PAYMENT_TTL_MINUTES);
  return shifted(placedAt, ttlMinutes * MILLISECONDS_PER_MINUTE);
}

/** The expiry of the reservations of an order that expires at `orderExpiry`: always later than the order. */
export function reservationExpiresAt(orderExpiry: Date): Date {
  assertDate(orderExpiry, "orderExpiry");
  return shifted(orderExpiry, RESERVATION_GRACE_MINUTES * MILLISECONDS_PER_MINUTE);
}

/** The value of `access_expires_at` of a guest order created at `createdAt`. */
export function guestAccessExpiresAt(createdAt: Date, days: number): Date {
  assertDate(createdAt, "createdAt");
  assertInRange(days, "days", GUEST_ACCESS_DAYS);
  return shifted(createdAt, days * MILLISECONDS_PER_DAY);
}

/**
 * True before the access expires; the expiry instant itself is already expired. A `now` slightly before `createdAt`
 * (clock skew between servers) is still valid.
 */
export function isGuestAccessValid(createdAt: Date, now: Date, days: number): boolean {
  assertDate(now, "now");
  return now.getTime() < guestAccessExpiresAt(createdAt, days).getTime();
}
