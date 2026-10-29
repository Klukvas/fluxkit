import {
  isLivePaymentStatus,
  nextPaymentCheck,
  PAYMENT_CHECK_DELAYS_MINUTES,
  type PaymentStatus,
  type RefundStatus,
} from "@fluxkit/core";
import type { PaymentColumns } from "./attempts/payments.repository.js";

/*
 * The reconcile schedule of an attempt (`payment.next_check_at`, `payment.check_attempts`; ADR 0032 decision 13, job 11).
 * The column marks ALL work job 11 has for the attempt (plan step 3 decision d): reading a live attempt, closing a
 * crashed create, invalidating an invoice we closed, sending and settling refunds. `null` means nothing is left.
 */

const MINUTE_MS = 60_000;

export interface ScheduleInput {
  readonly status: PaymentStatus;
  readonly previousStatus: PaymentStatus | null;
  readonly expiresAt: Date;
  readonly nextCheckAt: Date | null;
  readonly checkAttempts: number;
  readonly refundStatuses: readonly RefundStatus[];
}

export type Schedule = Required<Pick<PaymentColumns, "nextCheckAt" | "checkAttempts">>;

/** Whether a succeeded attempt still has refund work: a refund to send, or one whose outcome is not known yet. */
export function refundWork(statuses: readonly RefundStatus[]): "send" | "settle" | null {
  if (statuses.includes("requested")) {
    return "send";
  }
  return statuses.some((status) => status === "unknown" || status === "processing")
    ? "settle"
    : null;
}

/**
 * The schedule after a change (a fact, a create record, a refund): a status that is entered starts its schedule
 * afresh; a status that stays keeps the one it has.
 * - `awaiting_customer`: read once the invoice ended (`expires_at`), then by the backoff (webhooks come before).
 * - `processing`: the first read 1 minute later.
 * - `create_unknown`: at the invoice end (closed then, or read when a fact bound the provider id).
 * - `succeeded`: now when a refund waits to be sent, 1 minute later when one is unsettled, else nothing.
 * - `invalidated` keeps the invalidation work its closing scheduled; `failed`, `expired`: nothing.
 */
export function scheduleAfterChange(input: ScheduleInput, now: Date): Schedule {
  const entered = input.status !== input.previousStatus;
  const keep: Schedule = { nextCheckAt: input.nextCheckAt, checkAttempts: input.checkAttempts };
  switch (input.status) {
    case "creating":
      return keep;
    case "awaiting_customer":
    case "create_unknown":
      return entered ? { nextCheckAt: input.expiresAt, checkAttempts: 0 } : keep;
    case "processing":
      return entered
        ? { nextCheckAt: new Date(now.getTime() + firstDelayMs()), checkAttempts: 0 }
        : keep;
    case "succeeded": {
      const work = refundWork(input.refundStatuses);
      if (work === "send") {
        return { nextCheckAt: now, checkAttempts: 0 };
      }
      if (work === "settle") {
        return input.nextCheckAt !== null && !entered
          ? keep
          : { nextCheckAt: new Date(now.getTime() + firstDelayMs()), checkAttempts: 0 };
      }
      return { nextCheckAt: null, checkAttempts: 0 };
    }
    case "invalidated":
      return entered ? { nextCheckAt: now, checkAttempts: 0 } : keep;
    case "failed":
    case "expired":
      return { nextCheckAt: null, checkAttempts: 0 };
  }
}

export interface PollScheduleResult {
  readonly schedule: Schedule;
  /** The backoff ended: raise `reconcile_gave_up` (once). */
  readonly gaveUp: boolean;
}

/**
 * The schedule after one status read of job 11 (answered or failed) that did not change the status: one more check
 * counted, the next by core `nextPaymentCheck` (1, 2, 5, 10, 30 minutes, then hourly for 48 hours). When the backoff
 * ends, attention `reconcile_gave_up`: a live attempt keeps being read hourly (the CHECK keeps a live attempt
 * scheduled, and its order waits on it), refund settling stops (an `unknown` refund is never failed automatically).
 */
export function scheduleAfterPoll(input: ScheduleInput, now: Date): PollScheduleResult {
  const checks = input.checkAttempts + 1;
  const decision = nextPaymentCheck({ checks, now });
  if (decision.action === "check") {
    return { schedule: { nextCheckAt: decision.at, checkAttempts: checks }, gaveUp: false };
  }
  if (isLivePaymentStatus(input.status)) {
    return {
      schedule: { nextCheckAt: new Date(now.getTime() + 60 * MINUTE_MS), checkAttempts: checks },
      gaveUp: true,
    };
  }
  return { schedule: { nextCheckAt: null, checkAttempts: checks }, gaveUp: true };
}

function firstDelayMs(): number {
  return (PAYMENT_CHECK_DELAYS_MINUTES[0] ?? 1) * MINUTE_MS;
}
