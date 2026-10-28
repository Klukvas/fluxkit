import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  isLivePaymentStatus,
  isProviderPaymentFact,
  type PaymentProviderPort,
  type PaymentProviderResult,
  type ProviderPaymentFact,
} from "@fluxkit/core";
import { retryOnDeadlock } from "../common/deadlock-retry.js";
import { applyJobLimits, DEFAULT_JOB_LIMITS, type JobLimits } from "../common/job-limits.js";
import { withTransaction, type Transaction } from "../common/transaction.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { OrdersRepository } from "../orders/orders.repository.js";
import { PaymentChanges, paymentStatusOf, refundStatusOf } from "./attempts/payment-changes.js";
import {
  PaymentsRepository,
  type DueCursor,
  type DuePayment,
  type PaymentRow,
} from "./attempts/payments.repository.js";
import { PaymentFactsService } from "./payment-facts.service.js";
import { callPaymentProvider, describePaymentCall } from "./payment-provider-call.js";
import { PaymentRefundsService } from "./payment-refunds.service.js";
import { refundWork, scheduleAfterPoll } from "./payment-schedule.js";
import { PAYMENT_TIMINGS, PAYMENTS_CONFIG, type PaymentsConfig } from "./payments-config.js";
import { PaymentProviderRegistry } from "./registry/index.js";

/** What job 11 did for one due attempt (counted in the job result). */
export type ReconcileAction =
  /** A `creating` attempt whose create was never recorded: closed `create_unknown`. */
  | "closed_crashed_create"
  /** A `create_unknown` attempt without a provider id after its invoice end: closed `failed`. */
  | "closed_create_unknown"
  /** A status read was applied (or was a duplicate of what we knew). */
  | "polled"
  /** The status read failed (timeout, error, malformed, refused): counted and backed off. */
  | "poll_failed"
  | "invalidated"
  | "invalidation_failed"
  | "refunds_sent"
  /** Nothing left to do: the schedule was cleared (or moved to the invoice end). */
  | "rescheduled"
  /** The provider throttled us: no more calls to it in this run. */
  | "rate_limited";

export interface ReconcileOneResult {
  readonly actions: readonly ReconcileAction[];
}

/**
 * The per-attempt work of job 11 `reconcile-payments` (ADR 0032 decision 13). Provider calls run with no transaction
 * open; every write is one short transaction in the lock order `sales_order` -> `payment` -> `payment_refund`. Facts go
 * through `PaymentFactsService` exactly like a webhook (source `poll`). What is done is decided from the row:
 * - `creating` past its recovery time: the process died between the insert and the record (or the call hangs beyond any
 *   timeout): `create_unknown` (whether the provider made an invoice is unknown; never retried).
 * - `create_unknown` without a provider id: nothing can be read (Monobank has no lookup by reference, M5); at its invoice
 *   end it is closed `failed` (`create_unknown`): nobody received its page.
 * - a live attempt with a provider id: a status read, applied as a `poll` fact; the backoff of core `nextPaymentCheck`;
 *   an invoice still unpaid after its end is closed (see `PaymentFactsService`).
 * - `succeeded` with refund work: `requested` refunds are sent (`PaymentRefundsService.sendRefund`); `unknown` and
 *   `processing` ones are settled by a status read (by our refund id), never by a second call.
 * - a closed attempt with a provider id and work (we closed it): `invalidatePayment`, failures tried
 *   `PAYMENT_TIMINGS.invalidationTries` times; `not_cancellable` means the provider took a payment meanwhile, so it is
 *   read and the success lands as a late or duplicate payment (refunded).
 */
@Injectable()
export class PaymentReconcileService {
  private readonly logger = new Logger("Payments");

  constructor(
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(PaymentsRepository) private readonly payments: PaymentsRepository,
    @Inject(PaymentChanges) private readonly changes: PaymentChanges,
    @Inject(OrdersRepository) private readonly orders: OrdersRepository,
    @Inject(PaymentFactsService) private readonly facts: PaymentFactsService,
    @Inject(PaymentRefundsService) private readonly refunds: PaymentRefundsService,
    @Inject(PaymentProviderRegistry) private readonly registry: PaymentProviderRegistry,
    @Inject(PAYMENTS_CONFIG) private readonly config: PaymentsConfig,
  ) {}

  /** Whether any provider is enabled (with none, job 11 does nothing: no attempt can exist). */
  enabled(): boolean {
    return this.registry.onlineEnabled();
  }

  listDue(now: Date, after: DueCursor | undefined, limit: number): Promise<DuePayment[]> {
    return this.payments.listDue(this.database, now, after, limit);
  }

  /**
   * Does the work of one due attempt. `paused` holds the providers that throttled us in this run: they get no further
   * call (the attempt stays due). Throws only for a database failure (the job reports it and goes on).
   */
  async reconcileOne(
    paymentId: string,
    now: Date,
    paused: Set<string>,
    limits: JobLimits = DEFAULT_JOB_LIMITS,
  ): Promise<ReconcileOneResult> {
    const row = await this.payments.findById(this.database, paymentId);
    if (
      row === undefined ||
      row.nextCheckAt === null ||
      row.nextCheckAt.getTime() > now.getTime()
    ) {
      return { actions: [] };
    }
    const provider = this.registry.get(row.providerCode);
    const status = paymentStatusOf(row.status);
    if (status === "creating") {
      return { actions: [await this.closeCrashedCreate(row.id, now, limits)] };
    }
    if (status === "create_unknown" && row.providerPaymentId === null) {
      return { actions: [await this.closeCreateUnknown(row.id, now, limits)] };
    }
    if (provider === undefined) {
      // A provider that is no longer enabled: its attempts wait by the backoff like a failed read (the order expiry
      // still runs to its cap), so they never fill the pages of every run; the schedule's end raises attention.
      this.logger.warn(
        `Payment ${row.id}: provider ${row.providerCode} is not enabled; not reconciled`,
      );
      await this.inTransaction(limits, async (tx) => {
        const locked = await this.lockWithOrder(tx, row.id);
        await this.countFailedRead(tx, locked, now);
      });
      return { actions: ["rescheduled"] };
    }
    if (paused.has(provider.code)) {
      return { actions: ["rate_limited"] };
    }
    if (isLivePaymentStatus(status)) {
      return { actions: [await this.poll(row, provider, now, paused, limits)] };
    }
    if (status === "succeeded") {
      return this.refundWork(row, provider, now, paused, limits);
    }
    return { actions: [await this.invalidate(row, provider, now, paused, limits)] };
  }

  /**
   * After `reconcileOne` threw (a database failure, a damaged row): the attempt is backed off like a failed read when its
   * schedule did not move, so a row that keeps failing is not read from the provider in every run and never fills the
   * pages of the job; the schedule's end raises `reconcile_gave_up`. Throws when this write fails too.
   */
  async backOffAfterFailure(paymentId: string, now: Date, limits: JobLimits): Promise<void> {
    await this.inTransaction(limits, async (tx) => {
      const locked = await this.lockWithOrder(tx, paymentId);
      if (locked.nextCheckAt !== null && locked.nextCheckAt.getTime() <= now.getTime()) {
        await this.countFailedRead(tx, locked, now);
      }
    });
  }

  private async closeCrashedCreate(
    paymentId: string,
    now: Date,
    limits: JobLimits,
  ): Promise<ReconcileAction> {
    return this.inTransaction(limits, async (tx) => {
      const row = await this.lockWithOrder(tx, paymentId);
      if (row.status !== "creating") {
        return "rescheduled";
      }
      this.logger.warn(
        `Payment ${row.id}: its create was never recorded; it is create_unknown now`,
      );
      const changed = await this.changes.transition(tx, row, "create_unknown", "system", {
        now,
        columns: {
          nextCheckAt: row.providerPaymentId === null ? row.expiresAt : now,
          checkAttempts: 0,
        },
        entry: { source: "system" },
      });
      if (!changed.ok) {
        throw new Error(`Closing a crashed create was refused: ${changed.reason}`);
      }
      return "closed_crashed_create";
    });
  }

  private async closeCreateUnknown(
    paymentId: string,
    now: Date,
    limits: JobLimits,
  ): Promise<ReconcileAction> {
    return this.inTransaction(limits, async (tx) => {
      const row = await this.lockWithOrder(tx, paymentId);
      if (row.status !== "create_unknown" || row.providerPaymentId !== null) {
        return "rescheduled";
      }
      if (now.getTime() < row.expiresAt.getTime()) {
        await this.changes.update(tx, row, { nextCheckAt: row.expiresAt }, now);
        return "rescheduled";
      }
      const changed = await this.changes.transition(tx, row, "failed", "system", {
        now,
        columns: {
          failureCode: "create_unknown",
          nextCheckAt: null,
          checkAttempts: 0,
          redirectUrl: null,
        },
        entry: { source: "system" },
      });
      if (!changed.ok) {
        throw new Error(`Closing a create_unknown attempt was refused: ${changed.reason}`);
      }
      return "closed_create_unknown";
    });
  }

  private async poll(
    row: PaymentRow,
    provider: PaymentProviderPort,
    now: Date,
    paused: Set<string>,
    limits: JobLimits,
  ): Promise<ReconcileAction> {
    const providerPaymentId = row.providerPaymentId;
    if (providerPaymentId === null) {
      return "rescheduled";
    }
    const call = await callPaymentProvider<ProviderPaymentFact>(
      (signal) => provider.getPayment(providerPaymentId, signal),
      this.config.providerTimeoutMs,
    );
    const result = this.checkedFact(call.result);
    if (result.ok) {
      await this.facts.applyProviderFact({
        providerCode: row.providerCode,
        fact: result.value,
        source: "poll",
        now,
        polledPaymentId: row.id,
        limits,
      });
      return "polled";
    }
    this.logger.warn(`Payment ${row.id}: getPayment ${describePaymentCall(call)}`);
    if (result.reason === "rate_limited") {
      paused.add(provider.code);
      await this.retryLater(row.id, now, result.retryAfterSeconds ?? null, limits);
      return "rate_limited";
    }
    await this.inTransaction(limits, async (tx) => {
      const locked = await this.lockWithOrder(tx, row.id);
      await this.countFailedRead(tx, locked, now);
    });
    return "poll_failed";
  }

  private async refundWork(
    row: PaymentRow,
    provider: PaymentProviderPort,
    now: Date,
    paused: Set<string>,
    limits: JobLimits,
  ): Promise<ReconcileOneResult> {
    const actions: ReconcileAction[] = [];
    const list = await this.payments.listRefundsOfPayment(this.database, row.id);
    for (const refund of list.filter((entry) => entry.status === "requested")) {
      const sent = await this.refunds.sendRefund(refund.id, now, limits);
      if (sent.kind === "rate_limited") {
        paused.add(provider.code);
        actions.push("rate_limited");
        return { actions };
      }
      if (!actions.includes("refunds_sent")) {
        actions.push("refunds_sent");
      }
    }
    const after = await this.payments.listRefundsOfPayment(this.database, row.id);
    const work = refundWork(after.map((refund) => refundStatusOf(refund.status)));
    if (work === "settle" && actions.length === 0) {
      // Only read when nothing was sent in this run: a refund just answered `unknown` waits for its first backoff step.
      actions.push(await this.poll(row, provider, now, paused, limits));
    } else if (work === null) {
      await this.inTransaction(limits, async (tx) => {
        const locked = await this.lockWithOrder(tx, row.id);
        await this.changes.update(tx, locked, { nextCheckAt: null, checkAttempts: 0 }, now);
      });
      if (actions.length === 0) {
        actions.push("rescheduled");
      }
    }
    return { actions };
  }

  private async invalidate(
    row: PaymentRow,
    provider: PaymentProviderPort,
    now: Date,
    paused: Set<string>,
    limits: JobLimits,
  ): Promise<ReconcileAction> {
    const providerPaymentId = row.providerPaymentId;
    if (providerPaymentId === null || !provider.capabilities.invalidateUnpaid) {
      await this.clear(row.id, now, limits);
      return "rescheduled";
    }
    const call = await callPaymentProvider<{ invalidated: boolean }>(
      (signal) => provider.invalidatePayment(providerPaymentId, signal),
      this.config.providerTimeoutMs,
    );
    if (call.result.ok) {
      await this.inTransaction(limits, async (tx) => {
        const locked = await this.lockWithOrder(tx, row.id);
        await this.changes.note(tx, locked.id, { source: "system" });
        await this.changes.update(tx, locked, { nextCheckAt: null, checkAttempts: 0 }, now);
      });
      return "invalidated";
    }
    const reason = call.result.reason;
    this.logger.warn(`Payment ${row.id}: invalidatePayment ${describePaymentCall(call)}`);
    if (reason === "rate_limited") {
      paused.add(provider.code);
      await this.retryLater(row.id, now, call.result.retryAfterSeconds ?? null, limits);
      return "rate_limited";
    }
    if (reason === "not_cancellable") {
      // The provider holds a payment (or is processing one) on the invoice we closed: read it, so a success lands
      // (refunded as a late or duplicate payment), then keep reading by the backoff until it settles.
      await this.poll(row, provider, now, paused, limits);
      await this.inTransaction(limits, async (tx) => {
        const locked = await this.lockWithOrder(tx, row.id);
        const status = paymentStatusOf(locked.status);
        if (status === "succeeded" || locked.nextCheckAt === null) {
          return;
        }
        const polled = scheduleAfterPoll(
          {
            status,
            previousStatus: status,
            expiresAt: locked.expiresAt,
            nextCheckAt: locked.nextCheckAt,
            checkAttempts: locked.checkAttempts,
            refundStatuses: [],
          },
          now,
        );
        await this.changes.update(tx, locked, polled.schedule, now);
        if (polled.gaveUp) {
          await this.changes.raiseAttention(tx, locked, "reconcile_gave_up", now);
        }
      });
      return "invalidation_failed";
    }
    await this.inTransaction(limits, async (tx) => {
      const locked = await this.lockWithOrder(tx, row.id);
      const tries = locked.checkAttempts + 1;
      await this.changes.update(
        tx,
        locked,
        tries >= PAYMENT_TIMINGS.invalidationTries
          ? { nextCheckAt: null, checkAttempts: tries }
          : { nextCheckAt: new Date(now.getTime() + 60_000), checkAttempts: tries },
        now,
      );
      if (tries >= PAYMENT_TIMINGS.invalidationTries) {
        this.logger.warn(
          `Payment ${row.id}: invalidating the invoice failed ${String(tries)} times; given up`,
        );
      }
    });
    return "invalidation_failed";
  }

  /** A failed status read: one more check counted, the next by the backoff; attention when it ends. */
  private async countFailedRead(tx: Transaction, row: PaymentRow, now: Date): Promise<void> {
    const status = paymentStatusOf(row.status);
    const refunds = await this.payments.lockRefundsOfPayment(tx, row.id);
    const polled = scheduleAfterPoll(
      {
        status,
        previousStatus: status,
        expiresAt: row.expiresAt,
        nextCheckAt: row.nextCheckAt,
        checkAttempts: row.checkAttempts,
        refundStatuses: refunds.map((refund) => refundStatusOf(refund.status)),
      },
      now,
    );
    const updated = await this.changes.update(tx, row, polled.schedule, now);
    if (polled.gaveUp) {
      this.logger.warn(`Payment ${row.id}: the reconcile schedule ended without a final answer`);
      await this.changes.raiseAttention(tx, updated, "reconcile_gave_up", now);
    }
  }

  private async retryLater(
    paymentId: string,
    now: Date,
    retryAfterSeconds: number | null,
    limits: JobLimits,
  ): Promise<void> {
    const waitMs =
      retryAfterSeconds === null ? PAYMENT_TIMINGS.rateLimitedRetryMs : retryAfterSeconds * 1_000;
    await this.inTransaction(limits, async (tx) => {
      const locked = await this.lockWithOrder(tx, paymentId);
      if (locked.nextCheckAt !== null) {
        await this.changes.update(
          tx,
          locked,
          { nextCheckAt: new Date(now.getTime() + waitMs) },
          now,
        );
      }
    });
  }

  private async clear(paymentId: string, now: Date, limits: JobLimits): Promise<void> {
    await this.inTransaction(limits, async (tx) => {
      const locked = await this.lockWithOrder(tx, paymentId);
      if (!isLivePaymentStatus(paymentStatusOf(locked.status))) {
        await this.changes.update(tx, locked, { nextCheckAt: null, checkAttempts: 0 }, now);
      }
    });
  }

  /** A read whose answer is not a well-formed fact is a malformed answer: `unavailable` (decision 7). */
  private checkedFact(
    result: PaymentProviderResult<ProviderPaymentFact>,
  ): PaymentProviderResult<ProviderPaymentFact> {
    if (result.ok && !isProviderPaymentFact(result.value)) {
      return { ok: false, reason: "unavailable", providerCodes: ["malformed_fact"] };
    }
    return result;
  }

  /** The order row first, then the attempt (the lock order of every payment write). */
  private async lockWithOrder(tx: Transaction, paymentId: string): Promise<PaymentRow> {
    const unlocked = await this.payments.findById(tx, paymentId);
    if (unlocked === undefined) {
      throw new Error("A due payment attempt disappeared");
    }
    await this.orders.lockById(tx, unlocked.orderId);
    const row = await this.payments.lockById(tx, paymentId);
    if (row === undefined) {
      throw new Error("A due payment attempt disappeared");
    }
    return row;
  }

  private inTransaction<T>(limits: JobLimits, work: (tx: Transaction) => Promise<T>): Promise<T> {
    return retryOnDeadlock(
      () =>
        withTransaction(this.database, async (tx) => {
          await applyJobLimits(tx, limits);
          return work(tx);
        }),
      (message) => this.logger.warn(message),
    );
  }
}
