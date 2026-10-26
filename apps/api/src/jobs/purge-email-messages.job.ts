import { EMAIL_MESSAGE_STATUSES, emailRetentionDays, type EmailMessageStatus } from "@fluxkit/core";
import type { Database } from "../database/database.module.js";
import type { EmailOutboxRepository, EmailPurgeGroup } from "../email/outbox/index.js";
import { DEFAULT_CLEANUP_LIMITS, drainInBatches, type BatchLimits } from "./batches.js";
import type { JobBudget } from "./job-budget.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Days a customer auth token is kept after it EXPIRED before job 10 deletes it (it can never be used again; the row
 * still counts for the per-email reset limit only within its first hour). The outbox retention of a sent mail.
 */
export const AUTH_TOKEN_RETENTION_DAYS = 30;

/** Final statuses: the only ones job 10 may delete (core `emailRetentionDays` is `null` for `pending` and `sending`). */
export const PURGEABLE_EMAIL_STATUSES: readonly EmailMessageStatus[] = Object.freeze(
  EMAIL_MESSAGE_STATUSES.filter((status) => emailRetentionDays(status) !== null),
);

/** The retention rules at `now`, one group per number of days (core `EMAIL_RETENTION_DAYS`: 30, and 90 for failed and unknown). */
export function emailPurgeGroups(now: Date): EmailPurgeGroup[] {
  const byDays = new Map<number, EmailMessageStatus[]>();
  for (const status of PURGEABLE_EMAIL_STATUSES) {
    const days = emailRetentionDays(status);
    if (days !== null) {
      byDays.set(days, [...(byDays.get(days) ?? []), status]);
    }
  }
  return [...byDays.entries()]
    .sort(([a], [b]) => a - b)
    .map(([days, statuses]) => ({ statuses, cutoff: new Date(now.getTime() - days * DAY_MS) }));
}

export interface PurgeEmailMessagesResult {
  /** Outbox rows deleted. */
  deleted: number;
  /** Expired customer auth tokens deleted. */
  tokensDeleted: number;
  truncated: boolean;
}

export interface PurgeEmailMessagesDeps {
  database: Database;
  outbox: Pick<EmailOutboxRepository, "deleteFinal" | "deleteExpiredAuthTokens">;
}

/**
 * Job 10 `purge-email-messages` (ADR 0031 decision 8, ADR 0025 bounds): deletes outbox rows in a final status whose last
 * change (`updated_at`) is strictly more than 30 days before `now` (`failed` and `unknown` 90 days), oldest first, in
 * bounded batches that skip rows another transaction holds; a `pending` or `sending` mail is never deleted, however
 * old. Then the customer auth tokens that expired strictly more than `AUTH_TOKEN_RETENTION_DAYS` before `now`.
 */
export async function purgeEmailMessages(
  deps: PurgeEmailMessagesDeps,
  now: Date,
  limits: BatchLimits = DEFAULT_CLEANUP_LIMITS,
  budget?: JobBudget,
): Promise<PurgeEmailMessagesResult> {
  const groups = emailPurgeGroups(now);
  const messages = await drainInBatches(
    (batchSize) =>
      deps.outbox.deleteFinal(deps.database, groups, PURGEABLE_EMAIL_STATUSES, batchSize),
    limits,
    budget,
  );
  const tokenCutoff = new Date(now.getTime() - AUTH_TOKEN_RETENTION_DAYS * DAY_MS);
  const tokens = await drainInBatches(
    (batchSize) => deps.outbox.deleteExpiredAuthTokens(deps.database, tokenCutoff, batchSize),
    limits,
    budget,
  );
  return {
    deleted: messages.total,
    tokensDeleted: tokens.total,
    truncated: messages.truncated || tokens.truncated,
  };
}
