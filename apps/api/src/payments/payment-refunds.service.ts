import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  decideRefund,
  PROVIDER_REFUND_STATUSES,
  refundStatusAfterCall,
  type Money,
  type PaymentProviderResult,
  type ProviderRefundStatus,
  type RefundRefusal,
} from "@fluxkit/core";
import { retryOnDeadlock } from "../common/deadlock-retry.js";
import { applyJobLimits, type JobLimits } from "../common/job-limits.js";
import { withTransaction, type Transaction } from "../common/transaction.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { PaymentChanges, paymentStatusOf, refundStatusOf } from "./attempts/payment-changes.js";
import {
  PaymentsRepository,
  type PaymentRow,
  type RefundRow,
} from "./attempts/payments.repository.js";
import { moneyOf } from "./payment-facts.service.js";
import { callPaymentProvider, describePaymentCall } from "./payment-provider-call.js";
import { scheduleAfterChange } from "./payment-schedule.js";
import { PAYMENT_TIMINGS, PAYMENTS_CONFIG, type PaymentsConfig } from "./payments-config.js";
import { PaymentProviderRegistry } from "./registry/index.js";

export type AdminRefundResult =
  | { readonly kind: "requested"; readonly replay: boolean; readonly refund: RefundRow }
  | { readonly kind: "refused"; readonly reason: RefundRefusal }
  | { readonly kind: "not_found" }
  /** The same `Idempotency-Key` was used for another payment, amount or note. */
  | { readonly kind: "idempotency_key_reused" };

export type SendRefundResult =
  /** The provider answered; the refund is now `processing`, `succeeded` or `failed`. */
  | { readonly kind: "answered"; readonly status: ProviderRefundStatus }
  /** The answer was lost (a timeout, an error, a malformed answer): `unknown`, settled by a status read, never resent. */
  | { readonly kind: "unknown" }
  /** Throttled, nothing processed: the refund stays `requested` and is sent again later. */
  | { readonly kind: "rate_limited"; readonly retryAfterSeconds: number | null }
  /** Another sender holds the claim, or the refund is no longer `requested`: nothing was sent. */
  | { readonly kind: "skipped" };

const SEND_CLAIM = "system:refund-send:";
const RETRY_ANSWER = "system:refund-retry:";

/**
 * Refunds of a succeeded attempt (ADR 0032 decisions 11 and 13; owner answer 3). A refund never changes the order status.
 *
 * Sending is EXACTLY ONCE per claim: before the provider call, a journal row with the unique dedupe key
 * `system:refund-send:<refundId>:<n>` is committed (two senders cannot both insert it); the call runs with no transaction
 * open; the answer is recorded under the payment row lock. Throttling (`rate_limited`, nothing processed) records
 * `system:refund-retry:<refundId>:<n>`, which frees claim `n + 1`. A claim without an answer is a send that died
 * mid-call: once it is older than `PAYMENT_TIMINGS.refundClaimStaleMs` the refund becomes `unknown` and is settled from
 * the provider's refund list by our refund id (`extRef`), never by a second call (a double refund would lose money).
 */
@Injectable()
export class PaymentRefundsService {
  private readonly logger = new Logger("Payments");

  constructor(
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(PaymentsRepository) private readonly payments: PaymentsRepository,
    @Inject(PaymentChanges) private readonly changes: PaymentChanges,
    @Inject(PaymentProviderRegistry) private readonly registry: PaymentProviderRegistry,
    @Inject(PAYMENTS_CONFIG) private readonly config: PaymentsConfig,
  ) {}

  /**
   * An admin's full or partial refund (the service method the admin route of plan step 8 calls; `payments.refund`).
   * Under the payment row lock: replay by `Idempotency-Key`, core `decideRefund` with every refund of the payment (the
   * cumulative limit holds under concurrency), insert `requested`. The send happens after commit (`sendRefund`, by the
   * route or job 11).
   */
  async requestAdminRefund(input: {
    /** The order in the route: a payment of another order is `not_found` (no oracle across orders). */
    readonly orderId: string;
    readonly paymentId: string;
    readonly adminId: string | null;
    readonly amount: Money;
    readonly note: string;
    readonly idempotencyKey: string;
    readonly now: Date;
  }): Promise<AdminRefundResult> {
    return retryOnDeadlock(
      () =>
        withTransaction(this.database, async (tx) => {
          const row = await this.payments.lockById(tx, input.paymentId);
          if (row === undefined || row.orderId !== input.orderId) {
            return { kind: "not_found" as const };
          }
          const replayed = await this.payments.findRefundByIdempotencyKey(tx, input.idempotencyKey);
          if (replayed !== undefined) {
            // The same key with another payment, amount, currency or note is another request.
            return replayed.paymentId === row.id &&
              replayed.amount === input.amount.amount &&
              replayed.currency === input.amount.currency &&
              replayed.note === input.note
              ? { kind: "requested" as const, replay: true, refund: replayed }
              : { kind: "idempotency_key_reused" as const };
          }
          const refunds = await this.payments.lockRefundsOfPayment(tx, row.id);
          const provider = this.registry.get(row.providerCode);
          const decision = decideRefund({
            payment: {
              status: paymentStatusOf(row.status),
              amount: moneyOf(row.amount, row.currency),
            },
            refunds: refunds.map((refund) => ({
              amount: moneyOf(refund.amount, refund.currency),
              status: refundStatusOf(refund.status),
            })),
            amount: input.amount,
            capabilities: {
              partialRefunds: provider?.capabilities.partialRefunds ?? false,
              multipleRefunds: provider?.capabilities.multipleRefunds ?? false,
            },
          });
          if (!decision.ok) {
            return { kind: "refused" as const, reason: decision.reason };
          }
          const refund = await this.changes.createRefund(tx, row, {
            amount: input.amount.amount,
            reason: "admin",
            actor: "admin",
            note: input.note,
            actorAdminId: input.adminId,
            idempotencyKey: input.idempotencyKey,
            now: input.now,
          });
          await this.changes.update(
            tx,
            row,
            { nextCheckAt: input.now, checkAttempts: 0 },
            input.now,
          );
          return { kind: "requested" as const, replay: false, refund };
        }),
      (message) => this.logger.warn(message),
    );
  }

  /** Sends one `requested` refund (see the class comment). Safe to call from several places at once. */
  async sendRefund(refundId: string, now: Date, limits?: JobLimits): Promise<SendRefundResult> {
    const claimed = await this.inTransaction(limits, (tx) => this.claim(tx, refundId, now));
    if (claimed.kind !== "claimed") {
      return claimed.result;
    }
    const { row, refund, attempt } = claimed;
    const provider = this.registry.get(row.providerCode);
    const providerPaymentId = row.providerPaymentId;
    const call =
      provider === undefined || providerPaymentId === null
        ? undefined
        : await callPaymentProvider<{ status: ProviderRefundStatus }>(
            (signal) =>
              provider.refund(
                {
                  providerPaymentId,
                  refundId: refund.id,
                  amount: moneyOf(refund.amount, refund.currency),
                  full: refund.amount === row.amount,
                },
                signal,
              ),
            this.config.providerTimeoutMs,
          );
    const answered: PaymentProviderResult<{ status: ProviderRefundStatus }> = call?.result ?? {
      ok: false,
      reason: "not_sent",
      providerCodes: ["provider_not_loaded"],
    };
    // An answer outside the port is a malformed answer: it may have reached the provider, so `unknown` (decision 13).
    const result: PaymentProviderResult<{ status: ProviderRefundStatus }> =
      answered.ok && !PROVIDER_REFUND_STATUSES.includes(answered.value.status)
        ? { ok: false, reason: "unavailable", providerCodes: ["malformed_answer"] }
        : answered;
    if (call !== undefined && !result.ok) {
      this.logger.warn(
        `Refund ${refund.id}: refund ${answered.ok ? "malformed answer" : describePaymentCall(call)}`,
      );
    }
    return this.inTransaction(limits, (tx) =>
      this.recordAnswer(tx, refund.id, attempt, result, now),
    );
  }

  private async claim(
    tx: Transaction,
    refundId: string,
    now: Date,
  ): Promise<
    | { kind: "claimed"; row: PaymentRow; refund: RefundRow; attempt: number }
    | { kind: "done"; result: SendRefundResult }
  > {
    const found = await this.payments.findRefund(tx, refundId);
    if (found === undefined) {
      throw new Error("No such refund");
    }
    const row = await this.payments.lockById(tx, found.paymentId);
    const refunds = await this.payments.lockRefundsOfPayment(tx, found.paymentId);
    const refund = refunds.find((entry) => entry.id === refundId);
    if (row === undefined || refund === undefined || refund.status !== "requested") {
      return { kind: "done", result: { kind: "skipped" } };
    }
    const claims = await this.payments.eventsWithKeyPrefix(
      tx,
      row.id,
      `${SEND_CLAIM}${refund.id}:`,
    );
    const answers = await this.payments.eventsWithKeyPrefix(
      tx,
      row.id,
      `${RETRY_ANSWER}${refund.id}:`,
    );
    if (claims.length > answers.length) {
      if (now.getTime() - refund.updatedAt.getTime() < PAYMENT_TIMINGS.refundClaimStaleMs) {
        return { kind: "done", result: { kind: "skipped" } };
      }
      // A send died without recording its answer: it may have reached the provider.
      this.logger.warn(`Refund ${refund.id}: a send has no recorded answer; it is unknown now`);
      const moved = await this.changes.transitionRefund(tx, row, refund, "unknown", "system", {
        now,
      });
      if (moved.ok) {
        await this.schedule(tx, moved.payment, now);
      }
      return { kind: "done", result: { kind: "unknown" } };
    }
    const attempt = claims.length + 1;
    const inserted = await this.changes.note(tx, row.id, {
      source: "system",
      dedupeKey: `${SEND_CLAIM}${refund.id}:${String(attempt)}`,
    });
    if (!inserted) {
      return { kind: "done", result: { kind: "skipped" } };
    }
    await this.payments.touchRefund(tx, refund.id, now);
    return { kind: "claimed", row, refund, attempt };
  }

  private async recordAnswer(
    tx: Transaction,
    refundId: string,
    attempt: number,
    result: PaymentProviderResult<{ status: ProviderRefundStatus }>,
    now: Date,
  ): Promise<SendRefundResult> {
    const found = await this.payments.findRefund(tx, refundId);
    if (found === undefined) {
      throw new Error("A refund disappeared while it was sent");
    }
    let row = await this.payments.lockById(tx, found.paymentId);
    const refund = (await this.payments.lockRefundsOfPayment(tx, found.paymentId)).find(
      (entry) => entry.id === refundId,
    );
    if (row === undefined || refund === undefined) {
      throw new Error("A refund disappeared while it was sent");
    }
    const outcome = refundStatusAfterCall(result);
    const current = refundStatusOf(refund.status);
    if (outcome.status === "requested") {
      if (current === "requested") {
        await this.changes.note(tx, row.id, {
          source: "system",
          dedupeKey: `${RETRY_ANSWER}${refund.id}:${String(attempt)}`,
        });
        const waitMs =
          outcome.retryAfterSeconds === null
            ? PAYMENT_TIMINGS.rateLimitedRetryMs
            : outcome.retryAfterSeconds * 1_000;
        await this.changes.update(tx, row, { nextCheckAt: new Date(now.getTime() + waitMs) }, now);
      }
      return { kind: "rate_limited", retryAfterSeconds: outcome.retryAfterSeconds };
    }
    if (current === "requested" || (current === "unknown" && outcome.status !== "unknown")) {
      // Our own call's answer (system); a refund a stale claim already made `unknown` is settled by it as a provider report.
      const actor = current === "requested" ? "system" : "provider";
      const moved = await this.changes.transitionRefund(tx, row, refund, outcome.status, actor, {
        now,
        columns: outcome.status === "failed" ? { failureCode: outcome.failureCode } : {},
      });
      if (moved.ok) {
        row = moved.payment;
        if (outcome.attentionCode !== null) {
          row = await this.changes.raiseAttention(tx, row, outcome.attentionCode, now);
        }
      }
    }
    await this.schedule(tx, row, now);
    return outcome.status === "unknown"
      ? { kind: "unknown" }
      : { kind: "answered", status: outcome.status };
  }

  private async schedule(tx: Transaction, row: PaymentRow, now: Date): Promise<void> {
    const refunds = await this.payments.lockRefundsOfPayment(tx, row.id);
    const status = paymentStatusOf(row.status);
    await this.changes.update(
      tx,
      row,
      scheduleAfterChange(
        {
          status,
          // Treated as entered, so unsettled refund work starts its backoff afresh.
          previousStatus: null,
          expiresAt: row.expiresAt,
          nextCheckAt: row.nextCheckAt,
          checkAttempts: row.checkAttempts,
          refundStatuses: refunds.map((refund) => refundStatusOf(refund.status)),
        },
        now,
      ),
      now,
    );
  }

  private inTransaction<T>(
    limits: JobLimits | undefined,
    work: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    return retryOnDeadlock(
      () =>
        withTransaction(this.database, async (tx) => {
          if (limits !== undefined) {
            await applyJobLimits(tx, limits);
          }
          return work(tx);
        }),
      (message) => this.logger.warn(message),
    );
  }
}
