import { Inject, Injectable } from "@nestjs/common";
import {
  decideEmailTransition,
  EMAIL_LEASE_SECONDS,
  type EmailMessageActor,
  type EmailMessageStatus,
  type EmailRecipientKind,
} from "@fluxkit/core";
import { DEFAULT_JOB_LIMITS, withJobTransaction, type JobLimits } from "../../common/job-limits.js";
import type { Transaction } from "../../common/transaction.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  decideEmailClaim,
  decideEmailRecord,
  type EmailAttemptOutcome,
  type EmailRecordDecision,
} from "./email-outcome.js";
import {
  EmailOutboxRepository,
  type EmailMessageRow,
  type NewEmailMessageRow,
} from "./email-outbox.repository.js";

/** A new mail as the writer stores it; `status`, `attempts` and the lease are the writer's. */
export type NewEmailMessage = Omit<
  NewEmailMessageRow,
  | "id"
  | "status"
  | "attempts"
  | "leaseUntil"
  | "providerCode"
  | "providerMessageId"
  | "lastErrorCode"
  | "sentAt"
  | "updatedAt"
> & { readonly createdAt: Date; readonly nextAttemptAt: Date; readonly deadlineAt: Date };

/** A mail whose attempt has started: `attempts` counts this attempt; `id` is the idempotency key. */
export interface ClaimedEmailMessage {
  readonly id: string;
  readonly templateKey: string;
  readonly templateVersion: number;
  readonly locale: string;
  readonly toAddress: string;
  readonly recipientKind: EmailRecipientKind;
  readonly customerId: string | null;
  readonly orderId: string | null;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly attempts: number;
  readonly deadlineAt: Date;
  readonly leaseUntil: Date;
}

export type EmailClaimResult =
  | { readonly kind: "claimed"; readonly message: ClaimedEmailMessage }
  /** Reached its deadline unsent: `failed` (it was pending) or `unknown` (its lease expired). */
  | { readonly kind: "expired"; readonly status: "failed" | "unknown" }
  /** Not due, gone, or held by another sender right now. Nothing written. */
  | { readonly kind: "skipped" };

export type EmailRecordResult =
  | { readonly kind: "recorded"; readonly decision: EmailRecordDecision }
  /**
   * The row is no longer this attempt's (`status` is not `sending` or `attempts` changed: the lease expired and another
   * sender claimed it). Nothing written: that sender records its own attempt.
   */
  | { readonly kind: "lost" };

function assertTransition(
  from: EmailMessageStatus | null,
  to: EmailMessageStatus,
  actor: EmailMessageActor,
): void {
  const decision = decideEmailTransition(from, to, actor);
  if (!decision.ok) {
    throw new RangeError(`An email message may not move from ${String(from)} to ${to} by ${actor}`);
  }
}

function claimedOf(row: EmailMessageRow): ClaimedEmailMessage {
  if (row.leaseUntil === null) {
    throw new Error("A claimed email_message row has no lease");
  }
  return Object.freeze({
    id: row.id,
    templateKey: row.templateKey,
    templateVersion: row.templateVersion,
    locale: row.locale,
    toAddress: row.toAddress,
    recipientKind: row.recipientKind as EmailRecipientKind,
    customerId: row.customerId,
    orderId: row.orderId,
    variables: row.variables as Record<string, unknown>,
    attempts: row.attempts,
    deadlineAt: row.deadlineAt,
    leaseUntil: row.leaseUntil,
  });
}

/**
 * The ONLY writer of `email_message` status (ADR 0031 decisions 5 to 7): creation, claim and record, each checked against
 * core `decideEmailTransition`. The claim and the record are two SHORT transactions with the job limits (statement 30 s,
 * lock 5 s); the provider is called between them by the sender with no transaction open. Creation runs in the CALLER's
 * transaction (a handler's or an auth flow's), so the mail commits with what caused it.
 */
@Injectable()
export class EmailMessageChanges {
  constructor(
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(EmailOutboxRepository) private readonly outbox: EmailOutboxRepository,
  ) {}

  /** `null -> pending`. `undefined` when the dedupe key exists already (a redelivered event): nothing written. */
  async create(
    tx: Transaction,
    values: NewEmailMessage,
    actor: EmailMessageActor,
  ): Promise<string | undefined> {
    assertTransition(null, "pending", actor);
    return this.outbox.insert(tx, {
      ...values,
      status: "pending",
      attempts: 0,
      updatedAt: values.createdAt,
    });
  }

  /**
   * Claims one due mail for the provider `providerCode` at `now`: `pending -> sending`, or `sending -> sending` for an
   * expired lease (attempts + 1, lease `EMAIL_LEASE_SECONDS`, the same id and so the same idempotency key). A due row at
   * or past its deadline is not claimed but closed (`decideEmailClaim`). Commits before the caller calls the provider.
   */
  claim(
    id: string,
    now: Date,
    providerCode: string,
    limits: JobLimits = DEFAULT_JOB_LIMITS,
  ): Promise<EmailClaimResult> {
    return withJobTransaction(
      this.database,
      async (tx): Promise<EmailClaimResult> => {
        const row = await this.outbox.lockClaimable(tx, id, now);
        if (row === undefined) {
          return { kind: "skipped" };
        }
        const decision = decideEmailClaim({
          status: row.status as EmailMessageStatus,
          deadlineAt: row.deadlineAt,
          now,
        });
        if (decision.to === "sending") {
          const leaseUntil = new Date(now.getTime() + EMAIL_LEASE_SECONDS * 1000);
          const claimed = await this.outbox.update(tx, id, {
            status: "sending",
            attempts: row.attempts + 1,
            leaseUntil,
            // A claimed row is due again when its lease ends (the claim's index finds expired leases by it).
            nextAttemptAt: leaseUntil,
            providerCode,
            updatedAt: now,
          });
          return { kind: "claimed", message: claimedOf(claimed) };
        }
        await this.outbox.update(tx, id, {
          status: decision.to,
          leaseUntil: null,
          lastErrorCode: decision.lastErrorCode,
          updatedAt: now,
        });
        return { kind: "expired", status: decision.to };
      },
      limits,
    );
  }

  /**
   * Records how the attempt number `claimed.attempts` ended, guarded by `status = 'sending' AND attempts = <claimed>`
   * under the row lock (`decideEmailRecord`: sent, back to pending with the next attempt, failed or unknown).
   */
  record(
    claimed: Pick<ClaimedEmailMessage, "id" | "attempts">,
    outcome: EmailAttemptOutcome,
    now: Date,
    limits: JobLimits = DEFAULT_JOB_LIMITS,
  ): Promise<EmailRecordResult> {
    return withJobTransaction(
      this.database,
      async (tx): Promise<EmailRecordResult> => {
        const row = await this.outbox.lock(tx, claimed.id);
        if (row === undefined || row.status !== "sending" || row.attempts !== claimed.attempts) {
          return { kind: "lost" };
        }
        const decision = decideEmailRecord({
          attempts: row.attempts,
          deadlineAt: row.deadlineAt,
          now,
          outcome,
        });
        switch (decision.status) {
          case "sent":
            await this.outbox.update(tx, row.id, {
              status: "sent",
              providerMessageId: decision.providerMessageId,
              sentAt: decision.sentAt,
              leaseUntil: null,
              lastErrorCode: null,
              updatedAt: now,
            });
            break;
          case "pending":
            await this.outbox.update(tx, row.id, {
              status: "pending",
              nextAttemptAt: decision.nextAttemptAt,
              leaseUntil: null,
              lastErrorCode: decision.lastErrorCode,
              updatedAt: now,
            });
            break;
          case "failed":
          case "unknown":
            await this.outbox.update(tx, row.id, {
              status: decision.status,
              leaseUntil: null,
              lastErrorCode: decision.lastErrorCode,
              updatedAt: now,
            });
            break;
        }
        return { kind: "recorded", decision };
      },
      limits,
    );
  }
}
