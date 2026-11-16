import { Inject, Injectable } from "@nestjs/common";
import {
  decideEmailTransition,
  EMAIL_LEASE_SECONDS,
  EMAIL_RETRY_MAX_DELAY_MINUTES,
  emailRetryDeadline,
  type EmailMessageActor,
  type EmailProviderCapabilities,
  type EmailProviderPort,
  nextEmailAttempt,
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
  admitEmailProvider,
  clearEmailProviderProbe,
  recordEmailProviderCooldown,
  emailChainWaitMs,
  SAFE_FALLBACK_REASONS,
  COOLDOWN_REASONS,
} from "./email-provider-state.js";
import {
  EmailOutboxRepository,
  type EmailMessageRow,
  type NewEmailMessageRow,
} from "./email-outbox.repository.js";

/** Configuration may recover between job passes; holding a pin must not postpone every retry to expiry. */
const PINNED_PROVIDER_RECHECK_MS = 60_000;
// Compute ordinary backoff independently of this mail's expiry; another provider may recover sooner.
const CHAIN_BACKOFF_HORIZON_MS = EMAIL_RETRY_MAX_DELAY_MINUTES * 60_000 + 1_000;

/** A new mail as the writer stores it; `status`, `attempts` and the lease are the writer's. */
export type NewEmailMessage = Omit<
  NewEmailMessageRow,
  | "id"
  | "status"
  | "attempts"
  | "leaseUntil"
  | "routeProviderCode"
  | "pinnedProviderCode"
  | "pinnedAt"
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
  readonly providerCode?: string | null;
  readonly routeProviderCode?: string | null;
  readonly providerProbeToken?: string;
  readonly pinnedProviderCode: string | null;
  readonly pinnedAt: Date | null;
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

export type EmailCancelResult =
  | { readonly kind: "cancelled"; readonly row: EmailMessageRow }
  | { readonly kind: "not_found" }
  /** The mail is not `pending` (claimed by a sender, or already final): nothing written. */
  | { readonly kind: "refused"; readonly status: EmailMessageStatus };

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
    providerCode: row.providerCode,
    routeProviderCode: row.routeProviderCode,
    pinnedProviderCode: row.pinnedProviderCode,
    pinnedAt: row.pinnedAt,
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
    providerCode: string | undefined,
    limits: JobLimits = DEFAULT_JOB_LIMITS,
    capabilities?: EmailProviderCapabilities,
    routing?: {
      readonly providers: readonly EmailProviderPort[];
      readonly excluded: readonly string[];
    },
  ): Promise<EmailClaimResult> {
    return withJobTransaction(
      this.database,
      async (tx): Promise<EmailClaimResult> => {
        const row = await this.outbox.lockClaimable(tx, id, now);
        if (row === undefined) {
          return { kind: "skipped" };
        }
        // A crashed attempt may have reached its provider. Persist its original claim time before any replay.
        const pin =
          row.pinnedProviderCode === null && row.status === "sending"
            ? {
                pinnedProviderCode: row.providerCode,
                pinnedAt: new Date((row.leaseUntil as Date).getTime() - EMAIL_LEASE_SECONDS * 1000),
              }
            : { pinnedProviderCode: row.pinnedProviderCode, pinnedAt: row.pinnedAt };
        if (row.status === "sending" && pin.pinnedProviderCode === null) {
          throw new Error("An expired email attempt has no provider code");
        }
        const pinnedProvider = routing?.providers.find(
          (item) => item.code === pin.pinnedProviderCode,
        );
        const preDecision = decideEmailClaim({
          status: row.status as EmailMessageStatus,
          deadlineAt: row.deadlineAt,
          pinnedAt: pin.pinnedAt,
          capabilities:
            routing === undefined
              ? pin.pinnedProviderCode !== null && pin.pinnedProviderCode !== providerCode
                ? undefined
                : capabilities
              : pinnedProvider?.capabilities,
          now,
        });
        if (preDecision.to !== "sending") {
          await this.outbox.update(tx, id, {
            ...pin,
            status: preDecision.to,
            leaseUntil: null,
            lastErrorCode: preDecision.lastErrorCode,
            updatedAt: now,
          });
          return { kind: "expired", status: preDecision.to };
        }
        let probeToken: string | undefined;
        if (routing !== undefined) {
          const desired = pin.pinnedProviderCode ?? row.routeProviderCode;
          const start =
            desired === null
              ? 0
              : Math.max(
                  0,
                  routing.providers.findIndex((item) => item.code === desired),
                );
          const candidates =
            pin.pinnedProviderCode === null
              ? routing.providers
                  .slice(start)
                  .filter((item) => !routing.excluded.includes(item.code))
              : routing.providers.filter((item) => item.code === pin.pinnedProviderCode);
          providerCode = undefined;
          capabilities = undefined;
          let waitMs = Number.POSITIVE_INFINITY;
          for (const candidate of candidates) {
            const admission = await admitEmailProvider(tx, candidate.code);
            if (!admission.allowed) {
              waitMs = Math.min(waitMs, admission.waitMs);
              continue;
            }
            providerCode = candidate.code;
            capabilities = candidate.capabilities;
            probeToken = admission.probeToken;
            break;
          }
          if (providerCode === undefined && candidates.length > 0 && now < row.deadlineAt) {
            if (pin.pinnedAt === null) {
              const retry = nextEmailAttempt({
                attempts: Math.max(1, row.attempts),
                failure: { reason: "not_sent" },
                now,
                deadlineAt: new Date(now.getTime() + CHAIN_BACKOFF_HORIZON_MS),
              });
              if (retry.status !== "pending") throw new Error("email_chain_backoff_invalid");
              waitMs = await emailChainWaitMs(
                tx,
                routing.providers.map((item) => item.code),
                retry.nextAttemptAt.getTime() - now.getTime(),
              );
            }
            await this.outbox.update(tx, id, {
              ...pin,
              status: "pending",
              leaseUntil: null,
              routeProviderCode: pin.pinnedProviderCode === null ? null : row.routeProviderCode,
              nextAttemptAt: new Date(
                Math.min(
                  emailRetryDeadline(
                    row.deadlineAt,
                    pin.pinnedAt,
                    pinnedProvider?.capabilities,
                  ).getTime(),
                  now.getTime() + Math.max(1000, waitMs),
                ),
              ),
              lastErrorCode: "provider_cooldown",
              updatedAt: now,
            });
            return { kind: "skipped" };
          }
        }
        const providerMissing =
          pin.pinnedProviderCode !== null && pin.pinnedProviderCode !== providerCode;
        const decision = decideEmailClaim({
          status: row.status as EmailMessageStatus,
          deadlineAt: row.deadlineAt,
          pinnedAt: pin.pinnedAt,
          capabilities: providerMissing ? undefined : capabilities,
          now,
        });
        if (decision.to === "sending" && (providerMissing || providerCode === undefined)) {
          if (pin.pinnedProviderCode !== null) {
            // Recheck configuration without changing the pin. An absent provider has no known replay window;
            // its restored capabilities will enforce the original cutoff before any call can start.
            await this.outbox.update(tx, id, {
              ...pin,
              status: "pending",
              leaseUntil: null,
              nextAttemptAt: new Date(
                Math.min(
                  now.getTime() + PINNED_PROVIDER_RECHECK_MS,
                  emailRetryDeadline(
                    row.deadlineAt,
                    pin.pinnedAt,
                    providerMissing ? undefined : capabilities,
                  ).getTime(),
                ),
              ),
              lastErrorCode: "pinned_provider_unavailable",
              updatedAt: now,
            });
          }
          return { kind: "skipped" };
        }
        if (decision.to === "sending") {
          const leaseUntil = new Date(now.getTime() + EMAIL_LEASE_SECONDS * 1000);
          const claimed = await this.outbox.update(tx, id, {
            ...pin,
            status: "sending",
            attempts: row.attempts + 1,
            leaseUntil,
            // A claimed row is due again when its lease ends (the claim's index finds expired leases by it).
            nextAttemptAt: leaseUntil,
            providerCode,
            updatedAt: now,
          });
          return {
            kind: "claimed",
            message: {
              ...claimedOf(claimed),
              ...(probeToken === undefined ? {} : { providerProbeToken: probeToken }),
            },
          };
        }
        await this.outbox.update(tx, id, {
          ...pin,
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

  /** Return an unattempted claim to the queue, without spending an attempt or overwriting a newer claim. */
  defer(
    claimed: ClaimedEmailMessage,
    now: Date,
    limits: JobLimits = DEFAULT_JOB_LIMITS,
  ): Promise<{ kind: "deferred" | "lost" }> {
    return withJobTransaction(
      this.database,
      async (tx) => {
        const row = await this.outbox.lock(tx, claimed.id);
        if (
          row === undefined ||
          row.status !== "sending" ||
          row.attempts !== claimed.attempts ||
          row.leaseUntil?.getTime() !== claimed.leaseUntil.getTime()
        )
          return { kind: "lost" };
        assertTransition("sending", "pending", "system");
        await this.outbox.update(tx, row.id, {
          status: "pending",
          attempts: row.attempts - 1,
          leaseUntil: null,
          routeProviderCode:
            row.pinnedProviderCode === null ? row.providerCode : row.routeProviderCode,
          nextAttemptAt: new Date(Math.min(now.getTime() + 1_000, row.deadlineAt.getTime())),
          updatedAt: now,
        });
        return { kind: "deferred" };
      },
      limits,
    );
  }

  /**
   * `pending -> cancelled` by an admin (ADR 0031 decision 5). Locks the row and waits for a sender that holds it right now,
   * then decides on the status it finds: a claim that committed first left `sending` (refused), a cancel that committed
   * first makes the claim skip the row (`lockClaimable`). So exactly one of cancel and claim wins, and two cancels at once
   * give one `cancelled` and one `refused`.
   */
  cancel(
    id: string,
    now: Date,
    limits: JobLimits = DEFAULT_JOB_LIMITS,
  ): Promise<EmailCancelResult> {
    return withJobTransaction(
      this.database,
      async (tx): Promise<EmailCancelResult> => {
        const row = await this.outbox.lock(tx, id);
        if (row === undefined) {
          return { kind: "not_found" };
        }
        const status = row.status as EmailMessageStatus;
        if (!decideEmailTransition(status, "cancelled", "admin").ok) {
          return { kind: "refused", status };
        }
        const cancelled = await this.outbox.update(tx, id, {
          status: "cancelled",
          leaseUntil: null,
          updatedAt: now,
        });
        return { kind: "cancelled", row: cancelled };
      },
      limits,
    );
  }

  /**
   * Records how the attempt number `claimed.attempts` ended, guarded by `status = 'sending' AND attempts = <claimed>`
   * under the row lock (`decideEmailRecord`: sent, back to pending with the next attempt, failed or unknown).
   */
  record(
    claimed: Pick<ClaimedEmailMessage, "id" | "attempts"> &
      Partial<Pick<ClaimedEmailMessage, "leaseUntil" | "providerCode">>,
    outcome: EmailAttemptOutcome,
    now: Date,
    limits: JobLimits = DEFAULT_JOB_LIMITS,
    capabilities?: EmailProviderCapabilities,
    routing?: {
      readonly nextProviderCode: string | null;
      readonly chainCodes: readonly string[];
      readonly probeToken?: string;
    },
  ): Promise<EmailRecordResult> {
    return withJobTransaction(
      this.database,
      async (tx): Promise<EmailRecordResult> => {
        const row = await this.outbox.lock(tx, claimed.id);
        if (
          row === undefined ||
          row.status !== "sending" ||
          row.attempts !== claimed.attempts ||
          (claimed.leaseUntil !== undefined &&
            row.leaseUntil?.getTime() !== claimed.leaseUntil.getTime()) ||
          (claimed.providerCode !== undefined && row.providerCode !== claimed.providerCode)
        ) {
          return { kind: "lost" };
        }
        const pin =
          row.pinnedProviderCode === null &&
          outcome.kind === "provider_failed" &&
          outcome.failure.reason === "unavailable"
            ? {
                pinnedProviderCode: row.providerCode,
                pinnedAt: new Date((row.leaseUntil as Date).getTime() - EMAIL_LEASE_SECONDS * 1000),
              }
            : { pinnedProviderCode: row.pinnedProviderCode, pinnedAt: row.pinnedAt };
        let decision = decideEmailRecord({
          attempts: row.attempts,
          deadlineAt: row.deadlineAt,
          now,
          outcome,
          pinnedAt: pin.pinnedAt,
          capabilities,
        });
        let routeProviderCode: string | null = null;
        if (routing !== undefined && row.providerCode !== null) {
          if (outcome.kind === "sent")
            await clearEmailProviderProbe(tx, row.providerCode, routing.probeToken);
          if (outcome.kind === "provider_failed") {
            const reason = outcome.failure.reason;
            if (COOLDOWN_REASONS.some((item) => item === reason)) {
              await recordEmailProviderCooldown(
                tx,
                row.providerCode,
                outcome.failure,
                row.attempts,
              );
            }
            if (pin.pinnedAt === null && SAFE_FALLBACK_REASONS.some((item) => item === reason)) {
              if (routing.nextProviderCode !== null && now < row.deadlineAt) {
                routeProviderCode = routing.nextProviderCode;
                decision = { status: "pending", nextAttemptAt: now, lastErrorCode: reason };
              } else {
                const backoff = nextEmailAttempt({
                  attempts: row.attempts,
                  failure: { reason: "not_sent" },
                  now,
                  deadlineAt: new Date(now.getTime() + CHAIN_BACKOFF_HORIZON_MS),
                });
                if (backoff.status !== "pending") throw new Error("email_chain_backoff_invalid");
                const waitMs = await emailChainWaitMs(
                  tx,
                  routing.chainCodes,
                  backoff.nextAttemptAt.getTime() - now.getTime(),
                  reason === "not_sent"
                    ? {
                        providerCode: row.providerCode,
                        waitMs: Math.max(
                          backoff.nextAttemptAt.getTime() - now.getTime(),
                          (outcome.failure.retryAfterSeconds ?? 0) * 1_000,
                        ),
                      }
                    : undefined,
                );
                const nextAttemptAt = new Date(now.getTime() + waitMs);
                decision =
                  nextAttemptAt < row.deadlineAt
                    ? { status: "pending", nextAttemptAt, lastErrorCode: reason }
                    : { status: "failed", lastErrorCode: "deadline_passed" };
              }
            }
          }
        }
        switch (decision.status) {
          case "sent":
            await this.outbox.update(tx, row.id, {
              ...pin,
              routeProviderCode,
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
              ...pin,
              routeProviderCode,
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
              ...pin,
              routeProviderCode,
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
