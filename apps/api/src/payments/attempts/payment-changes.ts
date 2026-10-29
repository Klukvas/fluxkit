import { Inject, Injectable } from "@nestjs/common";
import {
  buildPaymentEventPayload,
  buildRefundEventPayload,
  decidePaymentTransition,
  decideRefundTransition,
  PAYMENT_STATUSES,
  REFUND_STATUSES,
  type PaymentActor,
  type PaymentAttentionCode,
  type PaymentEventSource,
  type PaymentStatus,
  type ProviderPaymentFact,
  type RefundReason,
  type RefundStatus,
} from "@fluxkit/core";
import type { Transaction } from "../../common/transaction.js";
import {
  PaymentsRepository,
  type NewPaymentRow,
  type PaymentColumns,
  type PaymentRow,
  type RefundColumns,
  type RefundRow,
} from "./payments.repository.js";

/** One journal row's own facts: where it comes from, its dedupe key and, for a provider fact, the normalized fields. */
export interface JournalEntry {
  readonly source: PaymentEventSource;
  /** Required for `webhook` and `poll` (the replay guard); optional `<source>:...` for the others. */
  readonly dedupeKey?: string | null;
  readonly fact?: ProviderPaymentFact;
  /** Only with source `admin`. */
  readonly actorAdminId?: string | null;
}

/** Thrown inside a transaction when a journal row's dedupe key is already taken: the caller rolls back as a duplicate. */
export class DuplicatePaymentFact extends Error {
  constructor() {
    super("The payment fact was already journaled");
  }
}

export type PaymentChangeResult =
  | { readonly ok: true; readonly row: PaymentRow }
  | { readonly ok: false; readonly reason: "invalid_transition" | "not_allowed_for_actor" };

export function paymentStatusOf(value: string): PaymentStatus {
  if (!PAYMENT_STATUSES.includes(value as PaymentStatus)) {
    throw new RangeError(`A payment attempt has an unknown status: ${value}`);
  }
  return value as PaymentStatus;
}

export function refundStatusOf(value: string): RefundStatus {
  if (!REFUND_STATUSES.includes(value as RefundStatus)) {
    throw new RangeError(`A refund has an unknown status: ${value}`);
  }
  return value as RefundStatus;
}

function factColumns(fact: ProviderPaymentFact | undefined) {
  if (fact === undefined) {
    return {};
  }
  return {
    providerStatus: fact.providerStatus,
    providerModifiedAt: fact.modifiedAt,
    amount: fact.amount.amount,
    currency: fact.amount.currency,
    finalAmount: fact.finalAmount === null ? null : fact.finalAmount.amount,
    failureCode: fact.failureCode,
  };
}

/**
 * The ONLY writer of `payment.status` and `payment_refund.status` (ADR 0032 decision 2, `PaymentAttempts` in the ADR).
 * Every status comes from core `decidePaymentTransition` / `decideRefundTransition`; each change writes the row, its
 * `payment_event` journal row and its `payment.*` outbox event (core payload builders), all in the CALLER's transaction,
 * so the three commit or roll back together. The caller holds the order row and then the payment row `FOR UPDATE` (the
 * lock order of the repository) and never calls a provider inside that transaction. A journal row with a dedupe key
 * that is already taken throws `DuplicatePaymentFact`, so nothing the same fact already did happens twice.
 */
@Injectable()
export class PaymentChanges {
  constructor(@Inject(PaymentsRepository) private readonly payments: PaymentsRepository) {}

  /** Inserts a new attempt as `creating` (`null -> creating`, system only) with its first journal row; no event. */
  async create(
    tx: Transaction,
    values: Omit<NewPaymentRow, "status">,
    entry: JournalEntry,
  ): Promise<PaymentRow> {
    const decision = decidePaymentTransition(null, "creating", "system");
    if (!decision.ok) {
      throw new RangeError(`A payment attempt can not be created: ${decision.reason}`);
    }
    const row = await this.payments.insertAttempt(tx, { ...values, status: "creating" });
    await this.journal(tx, row.id, entry, { applied: true, from: null, to: "creating" });
    return row;
  }

  /**
   * Moves a LOCKED attempt to `to` with the columns the new status brings. A refusal of the state machine changes
   * nothing. Writes the journal row (with the fact when there is one) and `payment.status_changed`.
   */
  async transition(
    tx: Transaction,
    current: PaymentRow,
    to: PaymentStatus,
    actor: PaymentActor,
    options: {
      readonly now: Date;
      readonly columns?: PaymentColumns;
      readonly entry: JournalEntry;
    },
  ): Promise<PaymentChangeResult> {
    const from = paymentStatusOf(current.status);
    const decision = decidePaymentTransition(from, to, actor);
    if (!decision.ok) {
      return { ok: false, reason: decision.reason };
    }
    // The journal row first: a taken dedupe key aborts before anything else is written.
    await this.journal(tx, current.id, options.entry, { applied: true, from, to });
    const row = await this.payments.updateStatus(tx, current.id, to, {
      ...options.columns,
      updatedAt: options.now,
    });
    await this.payments.insertDomainEvent(tx, {
      type: "payment.status_changed",
      aggregateId: row.id,
      payload: {
        ...buildPaymentEventPayload({
          paymentId: row.id,
          orderId: row.orderId,
          orderNumber: await this.payments.orderNumberOf(tx, row.orderId),
          status: to,
        }),
      },
    });
    return { ok: true, row };
  }

  /**
   * Records a fact (or a system note) that does not change the status: the journal row (`applied` as given) and, when
   * applied, the columns it brings (provider status and time, final amount, card, the bound provider id).
   */
  async record(
    tx: Transaction,
    current: PaymentRow,
    options: {
      readonly now: Date;
      readonly applied: boolean;
      readonly columns?: PaymentColumns;
      readonly entry: JournalEntry;
    },
  ): Promise<PaymentRow> {
    await this.journal(tx, current.id, options.entry, {
      applied: options.applied,
      from: null,
      to: null,
    });
    if (options.columns === undefined || Object.keys(options.columns).length === 0) {
      return current;
    }
    return this.payments.update(tx, current.id, { ...options.columns, updatedAt: options.now });
  }

  /** Columns that are not the status and need no journal row of their own (the reconcile schedule, attention). */
  async update(
    tx: Transaction,
    current: PaymentRow,
    columns: PaymentColumns,
    now: Date,
  ): Promise<PaymentRow> {
    return this.payments.update(tx, current.id, { ...columns, updatedAt: now });
  }

  /**
   * Raises attention on a LOCKED attempt. The first open item keeps its code (an admin sees what went wrong first; the
   * journal keeps every fact); a cleared one is replaced.
   */
  async raiseAttention(
    tx: Transaction,
    current: PaymentRow,
    code: PaymentAttentionCode,
    now: Date,
  ): Promise<PaymentRow> {
    if (current.needsAttention) {
      return current;
    }
    return this.payments.update(tx, current.id, {
      needsAttention: true,
      attentionCode: code,
      updatedAt: now,
    });
  }

  /** Inserts a refund of a LOCKED, succeeded attempt as `requested` (`null -> requested`); no event. */
  async createRefund(
    tx: Transaction,
    current: PaymentRow,
    values: {
      readonly amount: number;
      readonly reason: RefundReason;
      readonly actor: "system" | "admin";
      readonly note?: string | null;
      readonly actorAdminId?: string | null;
      readonly idempotencyKey?: string | null;
      readonly now: Date;
    },
  ): Promise<RefundRow> {
    const decision = decideRefundTransition(null, "requested", values.actor);
    if (!decision.ok) {
      throw new RangeError(`A refund can not be created by ${values.actor}: ${decision.reason}`);
    }
    return this.payments.insertRefund(tx, {
      paymentId: current.id,
      amount: values.amount,
      currency: current.currency,
      paymentAmount: current.amount,
      status: "requested",
      reason: values.reason,
      note: values.note ?? null,
      actorAdminId: values.actorAdminId ?? null,
      idempotencyKey: values.idempotencyKey ?? null,
      createdAt: values.now,
      updatedAt: values.now,
    });
  }

  /**
   * Moves a LOCKED refund of a LOCKED attempt to `to`. A succeeded refund adds its amount to `refunded_amount` in the same
   * transaction. Writes `payment.refund_status_changed`. Answers the attempt as it is afterwards.
   */
  async transitionRefund(
    tx: Transaction,
    current: PaymentRow,
    refund: RefundRow,
    to: RefundStatus,
    actor: PaymentActor,
    options: { readonly now: Date; readonly columns?: RefundColumns },
  ): Promise<
    | { readonly ok: true; readonly payment: PaymentRow; readonly refund: RefundRow }
    | { readonly ok: false; readonly reason: "invalid_transition" | "not_allowed_for_actor" }
  > {
    const decision = decideRefundTransition(refundStatusOf(refund.status), to, actor);
    if (!decision.ok) {
      return { ok: false, reason: decision.reason };
    }
    const updated = await this.payments.updateRefundStatus(tx, refund.id, to, {
      ...options.columns,
      ...(to === "failed" ? {} : { failureCode: null }),
      updatedAt: options.now,
    });
    let payment = current;
    if (to === "succeeded") {
      payment = await this.payments.update(tx, current.id, {
        refundedAmount: current.refundedAmount + refund.amount,
        updatedAt: options.now,
      });
    }
    await this.payments.insertDomainEvent(tx, {
      type: "payment.refund_status_changed",
      aggregateId: refund.id,
      payload: {
        ...buildRefundEventPayload({
          refundId: refund.id,
          paymentId: current.id,
          orderId: current.orderId,
          orderNumber: await this.payments.orderNumberOf(tx, current.orderId),
          status: to,
        }),
      },
    });
    return { ok: true, payment, refund: updated };
  }

  /** A journal row without any other write (a system note, a claim). `false`: the dedupe key was taken. */
  async note(tx: Transaction, paymentId: string, entry: JournalEntry): Promise<boolean> {
    return this.payments.insertEvent(tx, {
      paymentId,
      source: entry.source,
      dedupeKey: entry.dedupeKey ?? null,
      ...factColumns(entry.fact),
      applied: false,
      fromStatus: null,
      toStatus: null,
      actorAdminId: entry.actorAdminId ?? null,
    });
  }

  private async journal(
    tx: Transaction,
    paymentId: string,
    entry: JournalEntry,
    change: { applied: boolean; from: PaymentStatus | null; to: PaymentStatus | null },
  ): Promise<void> {
    const inserted = await this.payments.insertEvent(tx, {
      paymentId,
      source: entry.source,
      dedupeKey: entry.dedupeKey ?? null,
      ...factColumns(entry.fact),
      applied: change.applied,
      fromStatus: change.from,
      toStatus: change.to,
      actorAdminId: entry.actorAdminId ?? null,
    });
    if (!inserted) {
      throw new DuplicatePaymentFact();
    }
  }
}
