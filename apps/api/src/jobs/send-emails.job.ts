import { Logger } from "@nestjs/common";
import { summarizeError } from "../common/error-summary.js";
import { DEFAULT_JOB_LIMITS, type JobLimits } from "../common/job-limits.js";
import type { Database } from "../database/database.module.js";
import {
  PROVIDER_WIDE_REASONS,
  type EmailDueCursor,
  type EmailOutboxRepository,
  type EmailSender,
} from "../email/outbox/index.js";
import { assertBatchLimits, type BatchLimits } from "./batches.js";
import type { JobBudget } from "./job-budget.js";

/** Pages of 20 due mails, at most 25 pages per run (ADR 0031 decision 6); the pacing and the budget stop it earlier. */
export const SEND_EMAIL_LIMITS: Readonly<BatchLimits> = Object.freeze({
  batchSize: 20,
  maxBatches: 25,
});

export interface SendEmailsResult {
  /** Due mails looked at. */
  scanned: number;
  /** Accepted by the provider. */
  sent: number;
  /** Failed for now and back to `pending` with their next attempt. */
  retried: number;
  /** Refused by the provider, past the deadline after a failure, or not renderable. */
  failed: number;
  /** An idempotency conflict: may have gone out, never retried automatically. */
  unknown: number;
  /** Reached their deadline unsent at the claim (`failed`, or `unknown` for an expired lease). */
  expired: number;
  /** Not due any more, held by another sender, or claimed again meanwhile. */
  skipped: number;
  /** The provider answered a reason that concerns every mail (rate limit, quota, configuration): the run stopped. */
  paused: boolean;
  /** Open mails while no provider is loaded (`EMAIL_PROVIDER=none`); they stay pending. */
  waitingWithoutProvider: number;
  /** Mails whose claim or record failed (a lock timeout): they stay due or leased for a later run. */
  failures: { messageId: string; error: string }[];
  truncated: boolean;
}

export interface SendEmailsDeps {
  database: Database;
  outbox: Pick<EmailOutboxRepository, "listDue" | "countOpen">;
  sender: Pick<EmailSender, "provider" | "attempt" | "warnWaitingWithoutProvider">;
}

export interface SendEmailsOptions {
  limits?: BatchLimits;
  budget?: JobBudget;
  /**
   * The time of each claim and record. Default: the tick's `now` plus the monotonic time elapsed since the job started,
   * so a mail sent late in a long run is claimed (and checked against its deadline) at its own time.
   */
  clock?: () => Date;
  /** Statement and lock timeouts of the claim and record transactions (default `DEFAULT_JOB_LIMITS`). */
  jobLimits?: JobLimits;
}

const logger = new Logger("Jobs");

function tickClock(now: Date): () => Date {
  const started = performance.now();
  return () => new Date(now.getTime() + Math.round(performance.now() - started));
}

/**
 * Job 9 `send-emails` (ADR 0031 decision 6, ADR 0025 bounds). Pages of due mails (`pending` whose `next_attempt_at` came,
 * `sending` whose lease expired), oldest due first, continued by a `(next_attempt_at, id)` cursor, so a mail that fails
 * is not read again in the run and never holds up the ones behind it. Each mail: claim, render, ONE provider call
 * outside any transaction (paced to `sendsPerSecond` per process together with the immediate attempts), record. A mail
 * whose claim or record fails is reported in `failures` and stays due or leased. A provider answer that concerns every
 * mail (`rate_limited`, `quota_exceeded`, `misconfigured`) stops the run; the mails not tried keep their place. The time
 * budget is checked before each page and each mail. With no provider loaded nothing is claimed, and a warning is logged
 * once per process when mails wait.
 */
export async function sendEmails(
  deps: SendEmailsDeps,
  now: Date,
  options: SendEmailsOptions = {},
): Promise<SendEmailsResult> {
  const limits = options.limits ?? SEND_EMAIL_LIMITS;
  assertBatchLimits(limits);
  const jobLimits = options.jobLimits ?? DEFAULT_JOB_LIMITS;
  const result: SendEmailsResult = {
    scanned: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    unknown: 0,
    expired: 0,
    skipped: 0,
    paused: false,
    waitingWithoutProvider: 0,
    failures: [],
    truncated: false,
  };
  if (deps.sender.provider() === undefined) {
    result.waitingWithoutProvider = await deps.outbox.countOpen(deps.database);
    deps.sender.warnWaitingWithoutProvider(result.waitingWithoutProvider);
    return result;
  }
  const clock = options.clock ?? tickClock(now);
  let cursor: EmailDueCursor | undefined;
  for (let page = 1; page <= limits.maxBatches; page += 1) {
    if (options.budget?.exhausted() === true) {
      result.truncated = true;
      return result;
    }
    const due = await deps.outbox.listDue(deps.database, now, cursor, limits.batchSize);
    for (const [index, mail] of due.entries()) {
      if (index > 0 && options.budget?.exhausted() === true) {
        result.truncated = true;
        return result;
      }
      cursor = mail.cursor;
      result.scanned += 1;
      let report;
      try {
        report = await deps.sender.attempt(mail.id, clock, jobLimits);
      } catch (error) {
        result.failures.push({ messageId: mail.id, error: summarizeError(error) });
        continue;
      }
      switch (report.kind) {
        case "sent":
          result.sent += 1;
          break;
        case "retry":
          result.retried += 1;
          break;
        case "failed":
          result.failed += 1;
          break;
        case "unknown":
          result.unknown += 1;
          break;
        case "expired":
          result.expired += 1;
          break;
        case "skipped":
        case "lost":
        case "deferred":
          result.skipped += 1;
          break;
        case "no_provider":
          // The provider is fixed at startup; reaching this means the registry changed under the job.
          throw new Error("The email provider disappeared during job 9");
      }
      const reason = "reason" in report ? report.reason : undefined;
      if (reason !== undefined && PROVIDER_WIDE_REASONS.includes(reason)) {
        result.paused = true;
        logger.warn(
          `Job send-emails: the provider answered ${reason}; the run stops, the other mails wait for their next attempt`,
        );
        return result;
      }
    }
    if (due.length < limits.batchSize) {
      return result;
    }
  }
  result.truncated = true;
  return result;
}
