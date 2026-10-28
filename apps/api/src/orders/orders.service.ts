import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  backorderHoldUntil,
  buildOrderEventPayload,
  compareMoney,
  createMoney,
  decideExpiry,
  decideOrderPaymentGuard,
  decideTransition,
  isGuestAccessCurrent,
  isLivePaymentStatus,
  orderEventTypeFor,
  reservationExpiresAt,
  type MarkPaidOutcome,
  type MarkPaidRequest,
  type OrderActor,
  type OrderPaymentsPort,
  type OrderStatus,
  type StockEffect,
  ORDER_STATUSES,
} from "@fluxkit/core";
import { CLOCK, type Clock } from "../auth/clock.js";
import { retryOnDeadlock } from "../common/deadlock-retry.js";
import { applyJobLimits, type JobLimits } from "../common/job-limits.js";
import { withTransaction, type Transaction } from "../common/transaction.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { ReservationsService } from "../inventory/reservations/reservations.service.js";
import { PaymentChanges, paymentStatusOf } from "../payments/attempts/payment-changes.js";
import { PaymentsRepository } from "../payments/attempts/payments.repository.js";
import { accessTokenMatches } from "./access-token.js";
import { ORDERS_CONFIG, type OrdersConfig } from "./orders-config.js";
import { OrdersRepository, type OrderRow, type OrderStatusUpdate } from "./orders.repository.js";

/*
 * The order domain service (ADR 0017, ADR 0018): the ONLY place an order changes status. `transition` asks the core
 * state machine (`decideTransition`), applies the stock effect to the order's reservations through the sorted batch
 * helpers of `ReservationsService`, writes the order row, the append-only status journal and the outbox event, all in the
 * caller's transaction. The callers (`markPaid`, the cancels, `expireOne`, `markFulfilled`) lock the order row
 * `FOR UPDATE` FIRST, then everything else follows in the documented order: levels sorted by (variant, location), then
 * reservations. A refusal is a return value and leaves nothing behind (the stock effect runs in a savepoint).
 */

/** Who changes the order. `adminId` is recorded in the journal and on `sale` movements; the others have none. */
export type OrderActorRef =
  | { readonly type: "customer" }
  | { readonly type: "guest" }
  | { readonly type: "admin"; readonly adminId: string | null }
  | { readonly type: "system" };

export type TransitionRefusal =
  | "invalid_transition"
  | "not_allowed_for_actor"
  /** A reservation of the order is gone (swept or released): the stock is no longer held, so it can not be paid. */
  | "order_not_payable"
  /** Fulfilment needs a backordered line's stock, which has not arrived yet. */
  | "awaiting_stock";

export interface TransitionOptions {
  readonly now: Date;
  /** Written to the journal and, for a cancellation, to the order (1 to 500 characters). */
  readonly reason?: string | null;
  /** `markPaid` only: the payment reference stored on the order. */
  readonly paymentReference?: string;
}

export type TransitionResult =
  | { readonly ok: true; readonly order: OrderRow }
  | { readonly ok: false; readonly reason: TransitionRefusal };

export type OrderChangeResult =
  | { readonly ok: true; readonly order: OrderRow }
  | {
      readonly ok: false;
      /** `payment_in_progress`: an online payment of the order is in flight (ADR 0032 decision 10). */
      readonly reason: "not_found" | "invalid_transition" | "payment_in_progress";
    };

/** `deferred`: an online payment is in flight, so the deadline moved on (ADR 0032 decision 8). */
export type ExpireOutcome = "expired" | "deferred" | "not_due" | "not_found";

/** What an admin's manual mark paid answers: `markPaid`'s outcome, or the online-payment guard (ADR 0032 decision 10). */
export type ManualMarkPaidOutcome =
  MarkPaidOutcome | { readonly ok: false; readonly reason: "payment_in_progress" };

const REASON_MAX = 500;
const REFERENCE_MAX = 255;

/** Thrown inside the savepoint of a transition to undo its stock effect; never leaves the service. */
class TransitionRefused extends Error {
  constructor(readonly reason: TransitionRefusal) {
    super(reason);
  }
}

/** Thrown inside the savepoint of `checkFulfilment` so that whatever the transition wrote is rolled back. */
class DryRunRolledBack extends Error {
  constructor() {
    super("dry run");
  }
}

function toStatus(value: string): OrderStatus {
  if (!ORDER_STATUSES.includes(value as OrderStatus)) {
    throw new RangeError(`The order has an unknown status: ${value}`);
  }
  return value as OrderStatus;
}

function assertPaymentReference(reference: unknown): asserts reference is string {
  if (typeof reference !== "string" || reference.length < 1 || reference.length > REFERENCE_MAX) {
    throw new RangeError(`A payment reference is 1 to ${String(REFERENCE_MAX)} characters`);
  }
}

function statusColumnsFor(
  to: OrderStatus,
  options: TransitionOptions,
): Omit<OrderStatusUpdate, "status"> {
  switch (to) {
    case "paid":
      return { paidAt: options.now, paymentReference: options.paymentReference ?? null };
    case "fulfilled":
      return { fulfilledAt: options.now };
    case "cancelled":
      return { cancelledAt: options.now, cancellationReason: options.reason ?? null };
    case "expired":
      return { expiredAt: options.now };
    case "awaiting_payment":
      throw new RangeError("An order enters awaiting_payment only at placement");
  }
}

@Injectable()
export class OrdersService implements OrderPaymentsPort {
  private readonly logger = new Logger("Orders");

  constructor(
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(OrdersRepository) private readonly orders: OrdersRepository,
    @Inject(ReservationsService) private readonly reservations: ReservationsService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PaymentsRepository) private readonly payments: PaymentsRepository,
    @Inject(PaymentChanges) private readonly paymentChanges: PaymentChanges,
    @Inject(ORDERS_CONFIG) private readonly config: OrdersConfig,
  ) {}

  /**
   * Writes the first journal row `(null -> awaiting_payment)` and the `order.placed` event of a new order, in the
   * checkout transaction. The same two writes every later transition makes, so there is one implementation of the
   * journal and of the outbox row.
   */
  async recordPlacement(
    tx: Transaction,
    order: OrderRow,
    actor: { readonly type: "customer" | "guest" },
  ): Promise<void> {
    await this.record(tx, order, null, "awaiting_payment", actor, null);
  }

  /**
   * Moves a LOCKED order to `to`. The caller holds the row `FOR UPDATE` and passes the row as read under that lock.
   * Asks `decideTransition`, then does the stock effect of the table (commit, release, release_unsold) on the order's
   * reservations in a savepoint, updates the order, journals the change and writes the event. A refusal changes
   * nothing. A reservation in a state that can only come from damaged data throws.
   */
  async transition(
    tx: Transaction,
    order: OrderRow,
    to: OrderStatus,
    actor: OrderActorRef,
    options: TransitionOptions,
  ): Promise<TransitionResult> {
    const from = toStatus(order.status);
    const decision = decideTransition(from, to, actor.type satisfies OrderActor);
    if (!decision.ok) {
      return { ok: false, reason: decision.reason };
    }
    try {
      const updated = await tx.transaction(async (savepoint) => {
        await this.applyStockEffect(
          savepoint,
          order,
          from,
          to,
          decision.stockEffect,
          actor,
          options,
        );
        const row = await this.orders.updateStatus(savepoint, order.id, {
          status: to,
          ...statusColumnsFor(to, options),
        });
        await this.record(savepoint, row, from, to, actor, options.reason ?? null);
        return row;
      });
      return { ok: true, order: updated };
    } catch (error) {
      if (error instanceof TransitionRefused) {
        return { ok: false, reason: error.reason };
      }
      throw error;
    }
  }

  /**
   * The payment entry point (`OrderPaymentsPort`), idempotent. Locks the order row first, so a payment, a cancellation
   * and the expiry job decide one after the other: exactly one of a paid and an expired order comes out of a race.
   * An expired or cancelled order is `order_not_payable` and nothing changes; the amount must equal the total in the
   * order currency; the same reference on a paid (or fulfilled) order is ok and changes nothing, another reference is
   * `payment_reference_conflict`. Payment commits every reservation that is on hand; backordered lines are held
   * for `BACKORDER_HOLD_DAYS` and committed at fulfilment (ADR 0017). The payment is not checked against the clock: an
   * order past its expiry that the job has not expired yet (its stock is still held) can still be paid.
   */
  async markPaid(
    orderId: string,
    request: MarkPaidRequest,
    actor: OrderActorRef = { type: "system" },
  ): Promise<MarkPaidOutcome> {
    assertPaymentReference(request.providerReference);
    return this.inTransaction((tx) => this.markPaidIn(tx, orderId, request, actor));
  }

  /**
   * `markPaid` inside the CALLER's transaction (ADR 0032 decision 7): the payments module applies a verified success in
   * one transaction, so the payment attempt, its journal and the order commit or roll back together. Same rules and
   * answers as `markPaid`; it locks the order row (a no-op when the caller already holds it, which the lock order of
   * ADR 0015 requires: `sales_order` -> `payment` -> reservations). No deadlock retry here: the caller owns the
   * transaction and retries it as a whole.
   */
  async markPaidIn(
    tx: Transaction,
    orderId: string,
    request: MarkPaidRequest,
    actor: OrderActorRef = { type: "system" },
  ): Promise<MarkPaidOutcome> {
    const reference = request.providerReference;
    assertPaymentReference(reference);
    const now = this.clock.now();
    const order = await this.orders.lockById(tx, orderId);
    if (order === undefined) {
      return { ok: false, reason: "order_not_found" };
    }
    const status = toStatus(order.status);
    if (status === "cancelled" || status === "expired") {
      return { ok: false, reason: "order_not_payable" };
    }
    const sameReference = order.paymentReference === reference;
    if ((status === "paid" || status === "fulfilled") && !sameReference) {
      return { ok: false, reason: "payment_reference_conflict" };
    }
    const total = createMoney(order.totalAmount, order.currency);
    if (!total.ok) {
      throw new RangeError(`Order ${order.number} has a total core rejects: ${total.reason}`);
    }
    const compared = compareMoney(request.amount, total.money);
    if (!compared.ok || compared.ordering !== 0) {
      return { ok: false, reason: "amount_mismatch" };
    }
    if (status === "paid" || status === "fulfilled") {
      return { ok: true, orderId: order.id, alreadyPaid: true };
    }
    const result = await this.transition(tx, order, "paid", actor, {
      now,
      paymentReference: reference,
    });
    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason === "order_not_payable" ? "order_not_payable" : "invalid_transition",
      };
    }
    return { ok: true, orderId: order.id, alreadyPaid: false };
  }

  /**
   * An admin's manual mark paid (offline payments such as a bank transfer; ADR 0032 decision 10, owner answer 3): the
   * online-payment guard first, under the order lock, then `markPaidIn` in the same transaction. Refused
   * `payment_in_progress` while an online attempt is `processing`, `create_unknown` or `creating`; an
   * `awaiting_customer` attempt is closed `invalidated` (job 11 invalidates its invoice; a success that still lands is a
   * `payment_reference_conflict` and is refunded automatically). `markPaid` (the port) keeps its contract unchanged.
   */
  async markPaidManually(
    orderId: string,
    request: MarkPaidRequest,
    actor: OrderActorRef,
  ): Promise<ManualMarkPaidOutcome> {
    assertPaymentReference(request.providerReference);
    const now = this.clock.now();
    return this.inTransaction(async (tx): Promise<ManualMarkPaidOutcome> => {
      const order = await this.orders.lockById(tx, orderId);
      if (order === undefined) {
        return { ok: false, reason: "order_not_found" };
      }
      if (!(await this.guardOnlinePayments(tx, order, actor, now))) {
        return { ok: false, reason: "payment_in_progress" };
      }
      return this.markPaidIn(tx, orderId, request, actor);
    });
  }

  /** `paid -> fulfilled` (admin by hand now, a shipping plugin later): commits the backordered lines or answers `awaiting_stock`. */
  async markFulfilled(
    orderId: string,
    actor: OrderActorRef,
  ): Promise<
    | { readonly ok: true; readonly order: OrderRow }
    | { readonly ok: false; readonly reason: "not_found" | "invalid_transition" | "awaiting_stock" }
  > {
    const now = this.clock.now();
    return this.inTransaction(async (tx) => {
      const order = await this.orders.lockById(tx, orderId);
      if (order === undefined) {
        return { ok: false, reason: "not_found" };
      }
      const result = await this.transition(tx, order, "fulfilled", actor, { now });
      if (result.ok) {
        return { ok: true, order: result.order };
      }
      return result.reason === "awaiting_stock"
        ? { ok: false, reason: "awaiting_stock" }
        : { ok: false, reason: "invalid_transition" };
    });
  }

  /**
   * Whether `paid -> fulfilled` would succeed for a LOCKED order right now, without changing anything (ADR 0029 decision
   * 10: a waybill needs the mark-fulfilled rule, "read without committing anything"). Runs the real transition, stock
   * effect included, in a savepoint that is ALWAYS rolled back, so the rule exists once: `ok` when it would succeed,
   * `awaiting_stock` while a backordered line is not on hand, `invalid_transition` when the order is not `paid`.
   */
  async checkFulfilment(
    tx: Transaction,
    order: OrderRow,
    actor: OrderActorRef,
    now: Date,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: TransitionRefusal }> {
    let outcome: TransitionResult | undefined;
    try {
      await tx.transaction(async (savepoint) => {
        outcome = await this.transition(savepoint, order, "fulfilled", actor, { now });
        throw new DryRunRolledBack();
      });
    } catch (error) {
      if (!(error instanceof DryRunRolledBack)) {
        throw error;
      }
    }
    if (outcome === undefined) {
      throw new Error("The fulfilment check ended without an outcome");
    }
    return outcome.ok ? { ok: true } : { ok: false, reason: outcome.reason };
  }

  /**
   * The guest cancels with the access token. `not_found` for an unknown number, a wrong or expired token and an order
   * of a customer alike (the caller answers one identical 404); `invalid_transition` once the order is not
   * `awaiting_payment`.
   */
  async cancelAsGuest(number: string, accessToken: string): Promise<OrderChangeResult> {
    const now = this.clock.now();
    return this.inTransaction(async (tx) => {
      const order = await this.orders.lockByNumber(tx, number);
      if (!this.guestMayOpen(order, accessToken, now) || order === undefined) {
        return { ok: false, reason: "not_found" };
      }
      return this.changeStatus(tx, order, "cancelled", { type: "guest" }, { now });
    });
  }

  /** A customer cancels their own order; the owner filter is in SQL, so another customer's number is `not_found`. */
  async cancelAsCustomer(customerId: string, number: string): Promise<OrderChangeResult> {
    const now = this.clock.now();
    return this.inTransaction(async (tx) => {
      const order = await this.orders.lockByNumberOfCustomer(tx, number, customerId);
      if (order === undefined) {
        return { ok: false, reason: "not_found" };
      }
      return this.changeStatus(tx, order, "cancelled", { type: "customer" }, { now });
    });
  }

  /** An admin cancels an `awaiting_payment` or `paid` order with a reason (1 to 500 characters). */
  async cancelAsAdmin(
    orderId: string,
    adminId: string | null,
    reason: string,
  ): Promise<OrderChangeResult> {
    const trimmed = typeof reason === "string" ? reason.trim() : "";
    if (trimmed.length < 1 || trimmed.length > REASON_MAX) {
      throw new RangeError(`A cancellation reason is 1 to ${String(REASON_MAX)} characters`);
    }
    const now = this.clock.now();
    return this.inTransaction(async (tx) => {
      const order = await this.orders.lockById(tx, orderId);
      if (order === undefined) {
        return { ok: false, reason: "not_found" };
      }
      return this.changeStatus(
        tx,
        order,
        "cancelled",
        { type: "admin", adminId },
        {
          now,
          reason: trimmed,
        },
      );
    });
  }

  /**
   * Expires one order whose `expires_at <= now` and releases its reservations (the scheduler's job, plan step 5c, calls
   * this per due order). Under the order lock the status and the time are checked again, so a payment or a
   * cancellation that got there first wins and this answers `not_due`.
   *
   * An online payment in flight defers it (ADR 0032 decision 8, owner answer 2; core `decideExpiry` with the order's
   * attempts, locked after the order): while an attempt is live, the deadline and the order's active reservations move
   * on in 10-minute steps, at most until `placed_at + ORDER_PAYMENT_TTL_MINUTES + 30 minutes`; each step is journaled as
   * a `system` payment event and makes job 11 read those attempts now. An order whose stock is no longer held cannot be
   * paid, so it is not deferred. At the cap the order expires anyway: an `awaiting_customer` attempt is closed
   * `invalidated`; a success that lands later is refunded automatically.
   */
  async expireOne(orderId: string, now: Date, limits?: JobLimits): Promise<ExpireOutcome> {
    return this.inTransaction(async (tx) => {
      if (limits !== undefined) {
        await applyJobLimits(tx, limits);
      }
      const order = await this.orders.lockById(tx, orderId);
      if (order === undefined) {
        return "not_found";
      }
      if (order.status !== "awaiting_payment" || order.expiresAt.getTime() > now.getTime()) {
        return "not_due";
      }
      const attempts = await this.payments.lockAttemptsOfOrder(tx, order.id);
      const decision = decideExpiry({
        now,
        orderExpiresAt: order.expiresAt,
        placedAt: order.placedAt,
        ttlMinutes: this.config.paymentTtlMinutes,
        attempts: attempts.map((attempt) => ({
          id: attempt.id,
          status: paymentStatusOf(attempt.status),
        })),
      });
      if (decision.action === "not_due") {
        return "not_due";
      }
      if (decision.action === "defer") {
        const held = await this.orders.listReservationsOfOrder(tx, order.id);
        if (held.every((entry) => entry.status === "active")) {
          await this.deferExpiry(tx, order, attempts, decision.expiresAt, now);
          return "deferred";
        }
      }
      if (decision.action === "expire" && decision.capReached) {
        this.logger.warn(
          `Order ${order.number}: expired at the payment deferral cap with an online payment still unconfirmed`,
        );
      }
      for (const attempt of attempts.filter((entry) => entry.status === "awaiting_customer")) {
        await this.invalidateAttempt(tx, attempt, { type: "system" }, now);
      }
      const result = await this.transition(tx, order, "expired", { type: "system" }, { now });
      if (!result.ok) {
        throw new Error(`Expiring a due order was refused: ${result.reason}`);
      }
      return "expired";
    });
  }

  /**
   * Whether a guest holding `accessToken` may open `order`: a guest order, a matching hash, a live expiry. `undefined`
   * (no such number) runs the same hash comparison against a dummy and answers false, so a miss costs the same as a wrong
   * token. Always exactly one comparison.
   */
  guestMayOpen(order: OrderRow | undefined, accessToken: string, now: Date): boolean {
    const matches = accessTokenMatches(accessToken, order?.accessTokenHash ?? null);
    return (
      order !== undefined &&
      matches &&
      order.customerId === null &&
      order.accessExpiresAt !== null &&
      isGuestAccessCurrent(order.accessExpiresAt, now)
    );
  }

  private async changeStatus(
    tx: Transaction,
    order: OrderRow,
    to: OrderStatus,
    actor: OrderActorRef,
    options: TransitionOptions,
  ): Promise<OrderChangeResult> {
    if (
      to === "cancelled" &&
      decideTransition(toStatus(order.status), to, actor.type).ok &&
      !(await this.guardOnlinePayments(tx, order, actor, options.now))
    ) {
      return { ok: false, reason: "payment_in_progress" };
    }
    const result = await this.transition(tx, order, to, actor, options);
    return result.ok
      ? { ok: true, order: result.order }
      : { ok: false, reason: "invalid_transition" };
  }

  /**
   * The online-payment guard of a cancel and of a manual mark paid of a LOCKED `awaiting_payment` order (ADR 0032
   * decision 10; core `decideOrderPaymentGuard` over the order's attempts, locked after the order): `false` while an
   * attempt is `processing`, `create_unknown` or `creating`; otherwise every `awaiting_customer` attempt is closed
   * `invalidated` in this transaction and `true`. Any other order status has nothing to guard.
   */
  private async guardOnlinePayments(
    tx: Transaction,
    order: OrderRow,
    actor: OrderActorRef,
    now: Date,
  ): Promise<boolean> {
    if (order.status !== "awaiting_payment") {
      return true;
    }
    const attempts = await this.payments.lockAttemptsOfOrder(tx, order.id);
    const decision = decideOrderPaymentGuard(
      attempts.map((attempt) => ({ id: attempt.id, status: paymentStatusOf(attempt.status) })),
    );
    if (!decision.ok) {
      return false;
    }
    for (const attempt of attempts.filter((entry) => decision.invalidate.includes(entry.id))) {
      await this.invalidateAttempt(tx, attempt, actor, now);
    }
    return true;
  }

  /** Closes an `awaiting_customer` attempt; job 11 invalidates its invoice at the provider (best effort, M14). */
  private async invalidateAttempt(
    tx: Transaction,
    attempt: Awaited<ReturnType<PaymentsRepository["lockAttemptsOfOrder"]>>[number],
    actor: OrderActorRef,
    now: Date,
  ): Promise<void> {
    const admin = actor.type === "admin";
    const changed = await this.paymentChanges.transition(
      tx,
      attempt,
      "invalidated",
      admin ? "admin" : "system",
      {
        now,
        columns: { redirectUrl: null, nextCheckAt: now, checkAttempts: 0 },
        entry: admin ? { source: "admin", actorAdminId: actor.adminId } : { source: "system" },
      },
    );
    if (!changed.ok) {
      throw new Error(`Invalidating a payment attempt was refused: ${changed.reason}`);
    }
  }

  /** One deferral step (see `expireOne`): the deadline, the active reservations, the journal and job 11. */
  private async deferExpiry(
    tx: Transaction,
    order: OrderRow,
    attempts: Awaited<ReturnType<PaymentsRepository["lockAttemptsOfOrder"]>>,
    expiresAt: Date,
    now: Date,
  ): Promise<void> {
    await this.orders.updateExpiresAt(tx, order.id, expiresAt);
    const held = await this.orders.listReservationsOfOrder(tx, order.id);
    const extended = await this.reservations.extendManyIn(
      tx,
      held.map((entry) => entry.reservationId),
      reservationExpiresAt(expiresAt),
    );
    for (const entry of extended) {
      if (!entry.result.ok) {
        throw new Error(
          `Extending a reservation of order ${order.number} for a payment in flight failed: ${entry.result.reason}`,
        );
      }
    }
    for (const attempt of attempts) {
      if (!isLivePaymentStatus(paymentStatusOf(attempt.status))) {
        continue;
      }
      await this.paymentChanges.note(tx, attempt.id, { source: "system" });
      // A read of the provider in this tick (job 11 runs after this job); a create in flight keeps its recovery time.
      if (
        attempt.providerPaymentId !== null &&
        (attempt.nextCheckAt === null || attempt.nextCheckAt.getTime() > now.getTime())
      ) {
        await this.paymentChanges.update(tx, attempt, { nextCheckAt: now }, now);
      }
    }
  }

  private async applyStockEffect(
    tx: Transaction,
    order: OrderRow,
    from: OrderStatus,
    to: OrderStatus,
    effect: StockEffect,
    actor: OrderActorRef,
    options: TransitionOptions,
  ): Promise<void> {
    if (effect === "reserve") {
      throw new RangeError("Reservations are created by the checkout, not by a transition");
    }
    const held = await this.orders.listReservationsOfOrder(tx, order.id);
    const active = held.filter((entry) => entry.status === "active");
    if (effect === "release" || effect === "release_unsold") {
      // `release_unsold` (a paid order, ADR 0022) leaves the committed ones alone: sold units stay sold, no restock.
      if (effect === "release" && held.some((entry) => entry.status === "committed")) {
        throw new Error(
          `Order ${order.number} is awaiting payment but holds a committed reservation.`,
        );
      }
      // A reservation the generic sweep already expired (or released) has nothing left to give back.
      const results = await this.reservations.releaseManyIn(
        tx,
        active.map((entry) => entry.reservationId),
      );
      for (const entry of results) {
        if (!entry.result.ok) {
          throw new Error(
            `Releasing a reservation of order ${order.number} failed: ${entry.result.reason}`,
          );
        }
      }
      return;
    }

    // effect === "commit": payment (awaiting_payment -> paid) or fulfilment (paid -> fulfilled).
    const commitFor = to === "paid" ? "payment" : "fulfilment";
    if (to === "paid" && held.some((entry) => entry.status !== "active")) {
      // The stock is no longer held (swept or released): the order can not be paid. Committed ones are damaged data.
      if (held.some((entry) => entry.status === "committed")) {
        throw new Error(
          `Order ${order.number} is awaiting payment but holds a committed reservation.`,
        );
      }
      throw new TransitionRefused("order_not_payable");
    }
    if (
      to === "fulfilled" &&
      held.some((entry) => entry.status === "expired" || entry.status === "released")
    ) {
      throw new Error(`Paid order ${order.number} lost a reservation before fulfilment.`);
    }
    const actorId = actor.type === "admin" ? actor.adminId : null;
    const results = await this.reservations.commitManyIn(
      tx,
      active.map((entry) => entry.reservationId),
      { actorId, reference: order.number },
    );
    const deferred: string[] = [];
    for (const entry of results) {
      if (entry.result.ok) {
        continue;
      }
      if (entry.result.reason === "insufficient_stock") {
        deferred.push(entry.reservationId);
        continue;
      }
      throw new Error(
        `Committing a reservation of order ${order.number} for ${commitFor} failed: ${entry.result.reason}`,
      );
    }
    if (deferred.length === 0) {
      return;
    }
    if (from === "paid") {
      // Fulfilment needs every unit on hand; the commits above roll back with the savepoint.
      throw new TransitionRefused("awaiting_stock");
    }
    // Payment: what is on hand is sold, the backordered rest is held until the stock arrives and fulfilment commits it.
    const extended = await this.reservations.extendManyIn(
      tx,
      deferred,
      backorderHoldUntil(options.now),
    );
    for (const entry of extended) {
      if (!entry.result.ok) {
        throw new Error(
          `Extending a backordered reservation of order ${order.number} failed: ${entry.result.reason}`,
        );
      }
    }
  }

  /** The journal row and the outbox row of a status the order has just entered, in the caller's transaction. */
  private async record(
    tx: Transaction,
    order: OrderRow,
    from: OrderStatus | null,
    to: OrderStatus,
    actor: OrderActorRef,
    reason: string | null,
  ): Promise<void> {
    await this.orders.insertStatusChange(tx, {
      orderId: order.id,
      fromStatus: from,
      toStatus: to,
      actorType: actor.type,
      actorAdminId: actor.type === "admin" ? actor.adminId : null,
      reason,
    });
    await this.orders.insertEvent(tx, {
      type: orderEventTypeFor(to),
      aggregateId: order.id,
      payload: buildOrderEventPayload({
        orderId: order.id,
        orderNumber: order.number,
        status: to,
      }),
    });
  }

  private inTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return retryOnDeadlock(
      () => withTransaction(this.database, work),
      (message) => this.logger.warn(message),
    );
  }
}
