import { AUTH_EMAIL_DEADLINE_MINUTES, EMAIL_DEADLINE_HOURS } from "./limits.js";
import { EMAIL_PROVIDER_FAILURE_REASONS, type EmailProviderFailure } from "./provider-port.js";

/*
 * When a failed send is tried again, and until when a mail may be sent at all (ADR 0031 decisions 6 and 7). Pure: the
 * caller passes `now`; all arithmetic is on UTC epoch milliseconds, so no time zone or summer time can shift it.
 */

/** Wait after attempt 1, 2, ... 6 of a retryable failure; later attempts wait `EMAIL_RETRY_MAX_DELAY_MINUTES`. */
export const EMAIL_RETRY_DELAYS_MINUTES: readonly number[] = Object.freeze([1, 2, 5, 10, 20, 40]);

export const EMAIL_RETRY_MAX_DELAY_MINUTES = 60;

/**
 * A daily quota is tried again at this UTC time (Resend resets it at midnight UTC, R8; five minutes of margin for the
 * clocks).
 */
export const EMAIL_QUOTA_RESET_UTC = Object.freeze({ hour: 0, minute: 5 });

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** The shortest relative wait: never now or in the past. */
const MIN_DELAY_MS = SECOND_MS;

export interface EmailAttemptInput {
  /** Attempts made so far, the failed one included (`email_message.attempts` after the claim): at least 1. */
  readonly attempts: number;
  readonly failure: Pick<EmailProviderFailure, "reason" | "retryAfterSeconds" | "quotaPeriod">;
  readonly now: Date;
  readonly deadlineAt: Date;
}

export type EmailAttemptDecision =
  | { readonly status: "pending"; readonly nextAttemptAt: Date }
  | { readonly status: "failed"; readonly cause: "rejected" | "deadline_passed" }
  | { readonly status: "unknown"; readonly cause: "idempotency_conflict" };

function timeOf(value: Date, name: string): number {
  const time = value instanceof Date ? value.getTime() : Number.NaN;
  if (Number.isNaN(time)) {
    throw new RangeError(`${name} must be a valid Date`);
  }
  return time;
}

/** The scheduled wait after attempt `attempts` (1-based). */
function scheduleDelayMs(attempts: number): number {
  const minutes = EMAIL_RETRY_DELAYS_MINUTES[attempts - 1] ?? EMAIL_RETRY_MAX_DELAY_MINUTES;
  return minutes * MINUTE_MS;
}

/** The first `EMAIL_QUOTA_RESET_UTC` strictly after `nowMs`. */
function nextQuotaResetMs(nowMs: number): number {
  const startOfDay = nowMs - (((nowMs % DAY_MS) + DAY_MS) % DAY_MS);
  const today =
    startOfDay + (EMAIL_QUOTA_RESET_UTC.hour * 60 + EMAIL_QUOTA_RESET_UTC.minute) * MINUTE_MS;
  return today > nowMs ? today : today + DAY_MS;
}

/**
 * What the record step does with a failed attempt:
 * - `rejected`: `failed` at once; `idempotency_conflict`: `unknown`, never retried automatically.
 * - `unavailable`, `not_sent`: the schedule (1, 2, 5, 10, 20, 40 minutes, then hourly), or a longer `retry-after`.
 * - `rate_limited`: exactly the `retry-after` when the service sent one, else the schedule.
 * - `misconfigured`: hourly (or a longer `retry-after`) until the operator fixes the key or the domain.
 * - `quota_exceeded`: a daily quota at the next 00:05 UTC strictly after now (or a later `retry-after`); a monthly quota
 *   or one the service did not name hourly (ADR 0031 open question 4).
 * - A relative wait is at least one second; a quota reset is an instant strictly after `now`. A next attempt at or after `deadlineAt` is not scheduled: the mail is
 *   `failed` `deadline_passed` now (decision 7: never sent at or after its deadline).
 * Input that can only be a bug (attempts below 1 or fractional, an invalid date, an unknown reason, a bad
 * `retryAfterSeconds`) throws a RangeError.
 */
export function nextEmailAttempt(input: EmailAttemptInput): EmailAttemptDecision {
  const { attempts, failure } = input;
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new RangeError("attempts must be a whole number of at least 1");
  }
  const nowMs = timeOf(input.now, "now");
  const deadlineMs = timeOf(input.deadlineAt, "deadlineAt");
  if (!EMAIL_PROVIDER_FAILURE_REASONS.includes(failure.reason)) {
    throw new RangeError(`Unknown email provider failure reason: ${String(failure.reason)}`);
  }
  const retryAfter = failure.retryAfterSeconds;
  if (retryAfter !== undefined && !(Number.isSafeInteger(retryAfter) && retryAfter >= 0)) {
    throw new RangeError("retryAfterSeconds must be a non-negative whole number of seconds");
  }
  // A relative wait is never shorter than one second (a `retry-after: 0` must not spin).
  const retryAfterMs = Math.max((retryAfter ?? 0) * SECOND_MS, MIN_DELAY_MS);

  let atMs: number;
  switch (failure.reason) {
    case "rejected":
      return Object.freeze({ status: "failed" as const, cause: "rejected" as const });
    case "idempotency_conflict":
      return Object.freeze({ status: "unknown" as const, cause: "idempotency_conflict" as const });
    case "unavailable":
    case "not_sent":
      atMs = nowMs + Math.max(scheduleDelayMs(attempts), retryAfterMs);
      break;
    case "rate_limited":
      atMs = nowMs + (retryAfter === undefined ? scheduleDelayMs(attempts) : retryAfterMs);
      break;
    case "misconfigured":
      atMs = nowMs + Math.max(EMAIL_RETRY_MAX_DELAY_MINUTES * MINUTE_MS, retryAfterMs);
      break;
    case "quota_exceeded":
      atMs =
        failure.quotaPeriod === "daily"
          ? Math.max(nextQuotaResetMs(nowMs), retryAfter === undefined ? 0 : nowMs + retryAfterMs)
          : nowMs + Math.max(EMAIL_RETRY_MAX_DELAY_MINUTES * MINUTE_MS, retryAfterMs);
      break;
  }
  if (atMs >= deadlineMs) {
    return Object.freeze({ status: "failed" as const, cause: "deadline_passed" as const });
  }
  return Object.freeze({ status: "pending" as const, nextAttemptAt: new Date(atMs) });
}

/**
 * `email_message.deadline_at` (ADR 0031 decision 7): `createdAt` + 12 hours; for an auth mail (a token goes with it)
 * the earlier of the token's expiry and `createdAt` + 1 hour (ADR 0031 open question 1, read as `min(expires_at,
 * created_at + 1 hour)`). An expired token gives a deadline in the past: the next claim fails the mail.
 */
export function emailDeadlineAt(input: {
  readonly createdAt: Date;
  readonly authTokenExpiresAt?: Date | null;
}): Date {
  const createdMs = timeOf(input.createdAt, "createdAt");
  if (input.authTokenExpiresAt === undefined || input.authTokenExpiresAt === null) {
    return new Date(createdMs + EMAIL_DEADLINE_HOURS * 60 * MINUTE_MS);
  }
  const expiresMs = timeOf(input.authTokenExpiresAt, "authTokenExpiresAt");
  return new Date(Math.min(expiresMs, createdMs + AUTH_EMAIL_DEADLINE_MINUTES * MINUTE_MS));
}

/** Whether a send may no longer start: at or after the deadline (a send starts strictly before it). */
export function isPastEmailDeadline(now: Date, deadlineAt: Date): boolean {
  return timeOf(now, "now") >= timeOf(deadlineAt, "deadlineAt");
}
