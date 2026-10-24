import { isTerminalShipmentStatus, type ShipmentStatus } from "@fluxkit/core";

/*
 * When the tracking job asks the carrier about a shipment next (ADR 0029 decision 10, plan section 9). Constants of the
 * API, not core rules: they decide outbound traffic, not what a shipment may become.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Time between two polls of a shipment the carrier answered for, by its status. */
export const TRACKING_INTERVAL_MS: Readonly<Partial<Record<ShipmentStatus, number>>> =
  Object.freeze({
    created: 2 * HOUR_MS,
    in_transit: 4 * HOUR_MS,
    arrived: 6 * HOUR_MS,
    returning: 6 * HOUR_MS,
  });

/** A shipment that is still not terminal this long after it was created is no longer polled (logged once). */
export const TRACKING_GIVE_UP_MS = 30 * DAY_MS;

/** After a failed poll: 5 minutes, doubled per further failure in a row, at most 6 hours. */
export const TRACKING_RETRY_FIRST_MS = 5 * MINUTE_MS;
export const TRACKING_RETRY_MAX_MS = 6 * HOUR_MS;

export type NextPoll =
  | { readonly kind: "at"; readonly at: Date }
  /** Terminal, or not a status that is polled (`pending`, `unknown`). */
  | { readonly kind: "none" }
  /** Still not terminal after `TRACKING_GIVE_UP_MS`: the job stops asking. */
  | { readonly kind: "given_up" };

/** The next poll after the carrier answered (or after an admin action left the shipment in `status`). */
export function nextPollAfterAnswer(status: ShipmentStatus, createdAt: Date, now: Date): NextPoll {
  const interval = TRACKING_INTERVAL_MS[status];
  if (isTerminalShipmentStatus(status) || interval === undefined) {
    return { kind: "none" };
  }
  if (now.getTime() - createdAt.getTime() >= TRACKING_GIVE_UP_MS) {
    return { kind: "given_up" };
  }
  return { kind: "at", at: new Date(now.getTime() + interval) };
}

/** The next poll after `attempts` failed polls in a row (`attempts` >= 1, already counted). */
export function nextPollAfterFailure(attempts: number, createdAt: Date, now: Date): NextPoll {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError("attempts must be a whole number of at least 1");
  }
  if (now.getTime() - createdAt.getTime() >= TRACKING_GIVE_UP_MS) {
    return { kind: "given_up" };
  }
  // 2^(attempts - 1) with the exponent capped, so a long outage cannot overflow the multiplication.
  const delay = Math.min(
    TRACKING_RETRY_FIRST_MS * 2 ** Math.min(attempts - 1, 20),
    TRACKING_RETRY_MAX_MS,
  );
  return { kind: "at", at: new Date(now.getTime() + delay) };
}

export function nextTrackAtOf(poll: NextPoll): Date | null {
  return poll.kind === "at" ? poll.at : null;
}
