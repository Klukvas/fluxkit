import { ORDER_STATUSES, type OrderStatus } from "../orders/status.js";

/*
 * Retention cut-offs (ADR 0033 decision 8). Pure date arithmetic in UTC milliseconds: a day is 24 hours, so a cut-off never
 * depends on the process time zone or a daylight-saving change. The periods of the privacy records are proposals.
 * TODO(fluxkit): legal review of PRIVACY_REQUEST_RETENTION_DAYS and AUDIT_EVENT_RETENTION_DAYS (plan questions 3 and 7).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RETENTION_DAYS = 36_500;

/** A completed or rejected request is kept 3 years as proof that it was answered, then deleted by job 12. */
export const PRIVACY_REQUEST_RETENTION_DAYS = 1095;

/** An admin audit event is kept 1 year, then deleted by job 12. */
export const AUDIT_EVENT_RETENTION_DAYS = 365;

/** The instant `days` whole days before `now`. Rows older than it are past the period. */
export function retentionCutoff(now: Date, days: number): Date {
  if (Number.isNaN(now.getTime())) {
    throw new RangeError("The current time is not a valid date");
  }
  if (!Number.isInteger(days) || days < 1 || days > MAX_RETENTION_DAYS) {
    throw new RangeError(
      `A retention period is a whole number of days from 1 to ${String(MAX_RETENTION_DAYS)}`,
    );
  }
  return new Date(now.getTime() - days * DAY_MS);
}

export interface RetentionOrderFacts {
  readonly status: OrderStatus;
  readonly fulfilledAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly expiredAt: Date | null;
  /** The time of the newest refund of the order's payments, if any. */
  readonly lastRefundAt: Date | null;
}

function closingTime(facts: RetentionOrderFacts): Date | null {
  switch (facts.status) {
    case "awaiting_payment":
    case "paid":
      return null;
    case "fulfilled":
      return required(facts.fulfilledAt, "fulfilled_at");
    case "cancelled":
      return required(facts.cancelledAt, "cancelled_at");
    case "expired":
      return required(facts.expiredAt, "expired_at");
  }
}

function required(value: Date | null, column: string): Date {
  if (value === null) {
    throw new RangeError(`A closed order has no ${column} (corrupt data)`);
  }
  return value;
}

/**
 * The day an order stopped changing: its closing time, or the newest refund when that is later. NULL while the order is
 * open. An unknown status or a closed order without its closing time is corrupt data (RangeError).
 */
export function orderFinalDate(facts: RetentionOrderFacts): Date | null {
  if (!ORDER_STATUSES.includes(facts.status)) {
    throw new RangeError(`Unknown order status: ${String(facts.status)}`);
  }
  const closed = closingTime(facts);
  if (closed === null) return null;
  const refund = facts.lastRefundAt;
  return refund !== null && refund.getTime() > closed.getTime() ? refund : closed;
}

/** True when the order is closed and its final date is strictly older than the cut-off. */
export function isOrderRetentionDue(facts: RetentionOrderFacts, cutoff: Date): boolean {
  const final = orderFinalDate(facts);
  return final !== null && final.getTime() < cutoff.getTime();
}
