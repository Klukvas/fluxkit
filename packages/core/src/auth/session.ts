export const SESSION_DEFAULTS = Object.freeze({ idleMinutes: 720, maxHours: 168 });

/** How far a stored timestamp may be ahead of `now` (clock skew between API instances and the database). */
export const SESSION_CLOCK_SKEW_MS = 5 * 60_000;
/** `last_seen_at` is refreshed at most this often. */
export const SESSION_TOUCH_INTERVAL_MS = 60_000;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export interface SessionTimes {
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly expiresAt?: Date;
}

export interface SessionLimits {
  readonly idleMinutes: number;
  readonly maxHours: number;
}

export type SessionEvaluation =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: "idle_timeout" | "max_lifetime" | "invalid_session" };

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function assertPositive(value: number, name: string): void {
  if (!(Number.isFinite(value) && value > 0)) {
    throw new RangeError(`${name} must be a positive number`);
  }
}

/** Absolute end of a session created at `createdAt`. */
export function sessionExpiry(createdAt: Date, limits: Pick<SessionLimits, "maxHours">): Date {
  assertPositive(limits.maxHours, "maxHours");
  if (!isValidDate(createdAt)) {
    throw new RangeError("createdAt must be a valid date");
  }
  return new Date(createdAt.getTime() + limits.maxHours * HOUR_MS);
}

/**
 * Order of checks: unreadable or impossible timestamps first (fail closed), then the absolute lifetime,
 * then the idle timeout. A limit reached exactly (now equals the limit) counts as expired.
 */
export function evaluateSession(
  session: SessionTimes,
  now: Date,
  limits: SessionLimits,
): SessionEvaluation {
  assertPositive(limits.idleMinutes, "idleMinutes");
  assertPositive(limits.maxHours, "maxHours");
  const invalid = { valid: false, reason: "invalid_session" } as const;
  const { createdAt, lastSeenAt, expiresAt } = session;
  if (!isValidDate(now) || !isValidDate(createdAt) || !isValidDate(lastSeenAt)) {
    return invalid;
  }
  if (expiresAt !== undefined && !isValidDate(expiresAt)) {
    return invalid;
  }
  const latestAcceptable = now.getTime() + SESSION_CLOCK_SKEW_MS;
  if (
    lastSeenAt.getTime() < createdAt.getTime() ||
    createdAt.getTime() > latestAcceptable ||
    lastSeenAt.getTime() > latestAcceptable
  ) {
    return invalid;
  }
  let absoluteEnd = sessionExpiry(createdAt, limits).getTime();
  if (expiresAt !== undefined) {
    absoluteEnd = Math.min(absoluteEnd, expiresAt.getTime());
  }
  if (now.getTime() >= absoluteEnd) {
    return { valid: false, reason: "max_lifetime" };
  }
  if (now.getTime() - lastSeenAt.getTime() >= limits.idleMinutes * MINUTE_MS) {
    return { valid: false, reason: "idle_timeout" };
  }
  return { valid: true };
}

export function shouldTouchSession(lastSeenAt: Date, now: Date): boolean {
  if (!isValidDate(lastSeenAt)) {
    return true;
  }
  return now.getTime() - lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS;
}
