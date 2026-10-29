import { createHash } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  bindFact,
  buildPollDedupeKey,
  buildProviderReference,
  decideOrderOutcome,
  decideRefund,
  decideRefundFromFact,
  isLivePaymentStatus,
  isProviderPaymentFact,
  normalizeProviderFact,
  type Money,
  type PaymentOrderOutcome,
  type PaymentStatus,
  type ProviderPaymentFact,
} from "@fluxkit/core";
import { retryOnDeadlock } from "../common/deadlock-retry.js";
import { applyJobLimits, type JobLimits } from "../common/job-limits.js";
import { withTransaction, type Transaction } from "../common/transaction.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { OrdersRepository } from "../orders/orders.repository.js";
import { OrdersService } from "../orders/orders.service.js";
import {
  DuplicatePaymentFact,
  PaymentChanges,
  paymentStatusOf,
  refundStatusOf,
  type JournalEntry,
} from "./attempts/payment-changes.js";
import {
  PaymentsRepository,
  type PaymentColumns,
  type PaymentRow,
  type RefundRow,
} from "./attempts/payments.repository.js";
import { scheduleAfterChange, scheduleAfterPoll } from "./payment-schedule.js";
import { PaymentProviderRegistry } from "./registry/index.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FactSource = "webhook" | "poll";

export interface ApplyFactInput {
  readonly providerCode: string;
  readonly fact: ProviderPaymentFact;
  readonly source: FactSource;
  /** `webhook:<sha256 of the raw body>`, or `undefined` for a poll (built here from the fact and the attempt). */
  readonly webhookDedupeKey?: string;
  readonly now: Date;
  /**
   * Job 11's status read of exactly this attempt: the schedule moves on (also for a duplicate read), and an invoice that
   * is still unpaid after its end is closed (`awaiting_customer` -> `invalidated`, `create_unknown` -> `failed`).
   */
  readonly polledPaymentId?: string;
  /**
   * An on-demand status read of exactly this attempt (the store status routes, the admin resync): the fact is applied
   * to this attempt (never looked up by the fact's ids), like a webhook it leaves job 11's schedule alone unless the
   * status changes. Not together with `polledPaymentId`.
   */
  readonly readPaymentId?: string;
  /** Statement and lock timeouts of the transaction (job 11 passes the job limits). */
  readonly limits?: JobLimits;
}

export type ApplyFactResult =
  /** No attempt has this provider id or reference (logged; a webhook answers 200, retries would not help). */
  | { readonly kind: "unknown_attempt" }
  /** The same fact was already journaled: nothing happened. */
  | { readonly kind: "duplicate"; readonly paymentId: string }
  /** The fact does not bind (decision 7): journaled `applied = false` with attention, never paid. */
  | { readonly kind: "not_bound"; readonly paymentId: string }
  /** Older than the last applied fact, or refused by the transition table: journaled `applied = false`. */
  | { readonly kind: "ignored"; readonly paymentId: string }
  | {
      readonly kind: "applied";
      readonly paymentId: string;
      readonly from: PaymentStatus;
      readonly to: PaymentStatus;
      readonly orderOutcome: PaymentOrderOutcome | null;
    };

/** The poll dedupe key's refund-list digest, keyed by the attempt so two attempts never share a key. */
function pollDigest(paymentId: string): (text: string) => string {
  return (text) => createHash("sha256").update(`${paymentId}\n${text}`, "utf8").digest("hex");
}

/**
 * Applies a VERIFIED provider fact (ADR 0032 decision 7): a webhook whose signature the provider port checked over the
 * raw body, or a status read the API made with the shop's credentials. Never anything a browser sent. One transaction
 * in the lock order `sales_order` -> `payment` -> `payment_refund` -> reservations (through `markPaidIn`):
 * 1. the journal's dedupe key (a replayed webhook, a repeated read) answers `duplicate` and changes nothing;
 * 2. core `bindFact` (provider id, our reference, amount, currency, final amount): a fact that does not bind is journaled
 *    `applied = false` with attention and never pays;
 * 3. core `normalizeProviderFact` (ordering by `modifiedAt`, the transition table): stale and refused facts are journaled
 *    `applied = false`;
 * 4. on entering `succeeded`, `OrdersService.markPaidIn` in THIS transaction and core `decideOrderOutcome`: `applied`,
 *    `already_paid`, or attention with a full automatic refund queued `requested` (late or duplicate payment; sent by job
 *    11 after commit, never here) or without one (amount mismatch);
 * 5. our refunds listed in the fact are settled by their refund id (core `decideRefundFromFact`).
 * The attempt's status changes only through `PaymentChanges`; the order's only through `OrdersService`.
 */
@Injectable()
export class PaymentFactsService {
  private readonly logger = new Logger("Payments");

  constructor(
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(PaymentsRepository) private readonly payments: PaymentsRepository,
    @Inject(PaymentChanges) private readonly changes: PaymentChanges,
    @Inject(OrdersRepository) private readonly orderRows: OrdersRepository,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(PaymentProviderRegistry) private readonly registry: PaymentProviderRegistry,
  ) {}

  /** Finds the attempt by the provider's id, else by our reference (which binds a `create_unknown` attempt). */
  async findAttempt(
    providerCode: string,
    fact: ProviderPaymentFact,
  ): Promise<PaymentRow | undefined> {
    const byProviderId = await this.payments.findByProviderPaymentId(
      this.database,
      providerCode,
      fact.providerPaymentId,
    );
    if (byProviderId !== undefined) {
      return byProviderId;
    }
    if (!UUID.test(fact.reference)) {
      return undefined;
    }
    const byReference = await this.payments.findById(this.database, fact.reference);
    return byReference?.providerCode === providerCode ? byReference : undefined;
  }

  async applyProviderFact(input: ApplyFactInput): Promise<ApplyFactResult> {
    if (!isProviderPaymentFact(input.fact)) {
      throw new RangeError("applyProviderFact needs a well-formed provider fact");
    }
    if (input.polledPaymentId !== undefined && input.readPaymentId !== undefined) {
      throw new RangeError("A fact is either job 11's read or an on-demand read, not both");
    }
    const readId = input.polledPaymentId ?? input.readPaymentId;
    const attempt =
      readId === undefined
        ? await this.findAttempt(input.providerCode, input.fact)
        : await this.payments.findById(this.database, readId);
    if (attempt === undefined) {
      return { kind: "unknown_attempt" };
    }
    try {
      return await retryOnDeadlock(
        () =>
          withTransaction(this.database, async (tx) => {
            if (input.limits !== undefined) {
              await applyJobLimits(tx, input.limits);
            }
            return this.applyIn(tx, attempt.id, attempt.orderId, input);
          }),
        (message) => this.logger.warn(message),
      );
    } catch (error) {
      if (error instanceof DuplicatePaymentFact) {
        // A concurrent delivery of the same fact won the dedupe key; this transaction rolled back.
        return { kind: "duplicate", paymentId: attempt.id };
      }
      throw error;
    }
  }

  /** The whole application inside the caller's transaction (see the class comment). */
  async applyIn(
    tx: Transaction,
    paymentId: string,
    orderId: string,
    input: ApplyFactInput,
  ): Promise<ApplyFactResult> {
    const { fact, now } = input;
    // Lock order: the order row first, then the attempt (ADR 0015, ADR 0032 decision 7).
    await this.orderRows.lockById(tx, orderId);
    let row = await this.payments.lockById(tx, paymentId);
    if (row === undefined) {
      throw new Error("A payment attempt disappeared under its order lock");
    }
    const dedupeKey =
      input.source === "webhook"
        ? requireKey(input.webhookDedupeKey)
        : buildPollDedupeKey(fact, pollDigest(row.id));
    const entry: JournalEntry = { source: input.source, dedupeKey, fact };
    const polled = input.polledPaymentId !== undefined;
    // Authoritative under the attempt lock (every journal row of an attempt is written under it); the unique key is
    // the second guard.
    if (await this.payments.hasEvent(tx, dedupeKey)) {
      if (polled) {
        await this.afterPoll(tx, row, fact, now);
      }
      return { kind: "duplicate", paymentId };
    }
    const refunds = await this.payments.lockRefundsOfPayment(tx, row.id);
    const amount = moneyOf(row.amount, row.currency);
    const bound = bindFact(fact, {
      id: row.id,
      providerPaymentId: row.providerPaymentId,
      amount,
    });
    if (!bound.ok) {
      this.logger.warn(
        `Payment ${row.id}: a ${input.source} fact does not bind (${bound.reason}); journaled, not applied`,
      );
      row = await this.changes.record(tx, row, { now, applied: false, entry });
      row = await this.changes.raiseAttention(tx, row, bound.attentionCode, now);
      if (polled) {
        await this.afterPoll(tx, row, fact, now);
      }
      return { kind: "not_bound", paymentId };
    }
    const from = paymentStatusOf(row.status);
    const decision = normalizeProviderFact(fact, {
      status: from,
      providerModifiedAt: row.providerModifiedAt,
      amount,
      refunds: refunds.map((refund) => ({
        amount: moneyOf(refund.amount, refund.currency),
        status: refundStatusOf(refund.status),
      })),
    });
    if (decision.kind !== "apply") {
      row = await this.changes.record(tx, row, { now, applied: false, entry });
      if (decision.kind === "refused" && decision.attentionCode !== null) {
        row = await this.changes.raiseAttention(tx, row, decision.attentionCode, now);
      }
      if (polled) {
        await this.afterPoll(tx, row, fact, now);
      }
      return { kind: "ignored", paymentId };
    }

    const to = decision.toStatus ?? from;
    const columns: PaymentColumns = {
      providerStatus: fact.providerStatus,
      providerModifiedAt: fact.modifiedAt,
      ...(fact.finalAmount === null ? {} : { finalAmount: fact.finalAmount.amount }),
      ...(fact.card === null ? {} : { cardSystem: fact.card.system, cardLast4: fact.card.last4 }),
      ...(bound.bindsProviderPaymentId ? { providerPaymentId: fact.providerPaymentId } : {}),
      ...((to === "failed" || to === "expired") && decision.toStatus !== null
        ? { failureCode: fact.failureCode }
        : {}),
      ...(isLivePaymentStatus(to) ? {} : { redirectUrl: null }),
    };
    if (decision.toStatus === null) {
      row = await this.changes.record(tx, row, { now, applied: true, columns, entry });
    } else {
      const changed = await this.changes.transition(tx, row, decision.toStatus, "provider", {
        now,
        columns,
        entry,
      });
      if (!changed.ok) {
        // normalizeProviderFact consulted the same table: unreachable unless the two disagree.
        throw new Error(`A provider fact was decided but refused: ${changed.reason}`);
      }
      row = changed.row;
    }
    if (decision.attentionCode !== null) {
      row = await this.changes.raiseAttention(tx, row, decision.attentionCode, now);
    }

    let orderOutcome: PaymentOrderOutcome | null = null;
    if (decision.markPaid) {
      const providerPaymentId = row.providerPaymentId;
      if (providerPaymentId === null) {
        throw new Error("A succeeded attempt has no provider payment id");
      }
      const answer = await this.orders.markPaidIn(
        tx,
        row.orderId,
        {
          amount,
          providerReference: buildProviderReference(row.providerCode, providerPaymentId),
          source: row.providerCode,
        },
        { type: "system" },
      );
      const outcome = decideOrderOutcome(answer);
      orderOutcome = outcome.orderOutcome;
      row = await this.changes.update(tx, row, { orderOutcome }, now);
      if (outcome.attentionCode !== null) {
        this.logger.warn(
          `Payment ${row.id}: a success the order could not take (${outcome.orderOutcome}); attention raised`,
        );
        row = await this.changes.raiseAttention(tx, row, outcome.attentionCode, now);
      }
      if (outcome.automaticRefund !== null) {
        await this.queueAutomaticRefund(tx, row, refunds, outcome.automaticRefund, now);
      }
      if (outcome.orderOutcome === "applied") {
        await this.closeOpenAttempts(tx, row, now);
      }
    }

    row = await this.settleRefunds(tx, row, fact, now);

    const latestRefunds = await this.payments.lockRefundsOfPayment(tx, row.id);
    const changedStatus = decision.toStatus !== null;
    if (polled && !changedStatus && orderOutcome === null) {
      await this.afterPoll(tx, row, fact, now, latestRefunds);
    } else {
      const schedule = scheduleAfterChange(
        {
          status: paymentStatusOf(row.status),
          previousStatus: from,
          expiresAt: row.expiresAt,
          nextCheckAt: row.nextCheckAt,
          checkAttempts: row.checkAttempts,
          refundStatuses: latestRefunds.map((refund) => refundStatusOf(refund.status)),
        },
        now,
      );
      row = await this.changes.update(tx, row, schedule, now);
      if (polled) {
        await this.closeIfLapsed(tx, row, fact, now);
      }
    }
    return { kind: "applied", paymentId, from, to, orderOutcome };
  }

  /**
   * The order is paid: another attempt of it that still waits for the shopper is closed `invalidated` (job 11
   * invalidates its invoice), so it cannot take a second payment. The order row is locked, so its attempts are locked
   * after it like everywhere else.
   */
  private async closeOpenAttempts(tx: Transaction, paid: PaymentRow, now: Date): Promise<void> {
    const attempts = await this.payments.lockAttemptsOfOrder(tx, paid.orderId);
    for (const attempt of attempts) {
      if (attempt.id === paid.id || attempt.status !== "awaiting_customer") {
        continue;
      }
      const changed = await this.changes.transition(tx, attempt, "invalidated", "system", {
        now,
        columns: { redirectUrl: null, nextCheckAt: now, checkAttempts: 0 },
        entry: { source: "system" },
      });
      if (!changed.ok) {
        throw new Error(`Closing an open attempt of a paid order was refused: ${changed.reason}`);
      }
    }
  }

  /** A full refund of a just-succeeded attempt the order could not take (late or duplicate payment, decision 11). */
  private async queueAutomaticRefund(
    tx: Transaction,
    row: PaymentRow,
    refunds: readonly RefundRow[],
    reason: "late_payment" | "duplicate_payment",
    now: Date,
  ): Promise<void> {
    const provider = this.registry.get(row.providerCode);
    const decision = decideRefund({
      payment: { status: "succeeded", amount: moneyOf(row.amount, row.currency) },
      refunds: refunds.map((refund) => ({
        amount: moneyOf(refund.amount, refund.currency),
        status: refundStatusOf(refund.status),
      })),
      amount: moneyOf(row.amount, row.currency),
      capabilities: {
        partialRefunds: provider?.capabilities.partialRefunds ?? false,
        multipleRefunds: provider?.capabilities.multipleRefunds ?? false,
      },
    });
    if (!decision.ok) {
      // Attention is already raised; an admin settles it.
      this.logger.warn(`Payment ${row.id}: no automatic refund (${decision.reason})`);
      return;
    }
    await this.changes.createRefund(tx, row, {
      amount: row.amount,
      reason,
      actor: "system",
      now,
    });
  }

  /** Our refunds the fact lists, settled by their refund id (decision 13). */
  private async settleRefunds(
    tx: Transaction,
    row: PaymentRow,
    fact: ProviderPaymentFact,
    now: Date,
  ): Promise<PaymentRow> {
    let current = row;
    const refunds = await this.payments.lockRefundsOfPayment(tx, row.id);
    for (const refund of refunds) {
      const status = refundStatusOf(refund.status);
      if (status === "succeeded" || status === "failed") {
        continue;
      }
      const decision = decideRefundFromFact(
        { id: refund.id, status, amount: moneyOf(refund.amount, refund.currency) },
        fact,
      );
      if (decision.kind === "attention") {
        current = await this.changes.raiseAttention(tx, current, decision.attentionCode, now);
        continue;
      }
      if (decision.kind === "none") {
        continue;
      }
      const listed = fact.refunds.find((entry) => entry.refundId === refund.id);
      const moved = await this.changes.transitionRefund(
        tx,
        current,
        refund,
        decision.toStatus,
        "provider",
        { now, columns: { providerModifiedAt: listed?.modifiedAt ?? null } },
      );
      if (moved.ok) {
        current = moved.payment;
        if (decision.attentionCode !== null) {
          current = await this.changes.raiseAttention(tx, current, decision.attentionCode, now);
        }
      }
    }
    return current;
  }

  /** Job 11's read changed nothing: count the check, schedule the next (or give up), close a lapsed invoice. */
  private async afterPoll(
    tx: Transaction,
    row: PaymentRow,
    fact: ProviderPaymentFact,
    now: Date,
    refunds?: readonly RefundRow[],
  ): Promise<void> {
    const list = refunds ?? (await this.payments.lockRefundsOfPayment(tx, row.id));
    const status = paymentStatusOf(row.status);
    const statuses = list.map((refund) => refundStatusOf(refund.status));
    let current = row;
    const polled = scheduleAfterPoll(
      {
        status,
        previousStatus: status,
        expiresAt: row.expiresAt,
        nextCheckAt: row.nextCheckAt,
        checkAttempts: row.checkAttempts,
        refundStatuses: statuses,
      },
      now,
    );
    const work =
      isLivePaymentStatus(status) ||
      statuses.some((entry) => entry === "unknown" || entry === "processing");
    if (work) {
      current = await this.changes.update(tx, current, polled.schedule, now);
      if (polled.gaveUp) {
        this.logger.warn(`Payment ${row.id}: the reconcile schedule ended without a final answer`);
        current = await this.changes.raiseAttention(tx, current, "reconcile_gave_up", now);
      }
    } else {
      current = await this.changes.update(
        tx,
        current,
        scheduleAfterChange(
          {
            status,
            previousStatus: status,
            expiresAt: row.expiresAt,
            nextCheckAt: row.nextCheckAt,
            checkAttempts: row.checkAttempts,
            refundStatuses: statuses,
          },
          now,
        ),
        now,
      );
    }
    await this.closeIfLapsed(tx, current, fact, now);
  }

  /**
   * An invoice the provider still reports unpaid (`created`) after its end: the shopper can no longer use it, and no
   * `expired` webhook comes (M8). We close it so the order is not held: `awaiting_customer` -> `invalidated`,
   * `create_unknown` -> `failed` (`create_unknown`), and job 11 invalidates it at the provider. A payment that still
   * lands is recorded and refunded (decision 10).
   */
  private async closeIfLapsed(
    tx: Transaction,
    row: PaymentRow,
    fact: ProviderPaymentFact,
    now: Date,
  ): Promise<void> {
    const status = paymentStatusOf(row.status);
    if (
      fact.status !== "created" ||
      now.getTime() < row.expiresAt.getTime() ||
      (status !== "awaiting_customer" && status !== "create_unknown")
    ) {
      return;
    }
    const to = status === "awaiting_customer" ? "invalidated" : "failed";
    const changed = await this.changes.transition(tx, row, to, "system", {
      now,
      columns: {
        redirectUrl: null,
        nextCheckAt: now,
        checkAttempts: 0,
        ...(to === "failed" ? { failureCode: "create_unknown" } : {}),
      },
      entry: { source: "system" },
    });
    if (!changed.ok) {
      throw new Error(`Closing a lapsed invoice was refused: ${changed.reason}`);
    }
  }
}

/** Stored money as core money (the CHECKs keep the currency a three-letter code core knows). */
export function moneyOf(amount: number, currency: string): Money {
  return { amount, currency: currency as Money["currency"] };
}

function requireKey(key: string | undefined): string {
  if (key === undefined) {
    throw new RangeError("A webhook fact needs its dedupe key");
  }
  return key;
}
