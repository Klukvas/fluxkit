import { Inject, Injectable, Logger } from "@nestjs/common";
import { CLOCK, type Clock } from "../../auth/clock.js";
import { retryOnDeadlock } from "../../common/deadlock-retry.js";
import {
  idempotencyKeyReused,
  notFound,
  paymentProviderUnavailable,
  ruleViolation,
  validationFailed,
} from "../../common/problem.js";
import { withTransaction } from "../../common/transaction.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { OrdersRepository } from "../../orders/orders.repository.js";
import { PaymentChanges } from "../attempts/payment-changes.js";
import {
  PaymentsRepository,
  type PaymentListCursor,
  type PaymentRow,
} from "../attempts/payments.repository.js";
import { PaymentReadsService } from "../payment-reads.service.js";
import { PaymentRefundsService } from "../payment-refunds.service.js";
import { PAYMENT_RETRY_AFTER_SECONDS } from "../store/store-payments.service.js";
import { toAdminPayments, toAdminRefund } from "./admin-payment-view.js";
import type {
  AdminPayment,
  AdminPaymentList,
  AdminPaymentPage,
  AdminRefundResult,
  ListAdminPaymentsQuery,
  RefundPaymentBody,
} from "./admin-payments.schemas.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REFUSAL_DETAIL = {
  refund_not_allowed:
    "This payment cannot be refunded (it did not succeed, or the provider takes one refund only).",
  refund_exceeds_remaining: "The amount is more than what is left to refund on this payment.",
  partial_refund_not_supported: "This payment provider refunds the whole amount only.",
} as const;

export interface RefundAnswer {
  /** `202` for a new refund (it may still be settling), `200` for a replay of the same `Idempotency-Key`. */
  readonly status: 200 | 202;
  readonly body: AdminRefundResult;
}

function encodeCursor(cursor: PaymentListCursor): string {
  return Buffer.from(
    JSON.stringify({ t: cursor.createdAt.toISOString(), i: cursor.id }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(value: string): PaymentListCursor {
  const invalid = () =>
    validationFailed([
      { path: "cursor", code: "invalid_cursor", message: "Pass `nextCursor` unchanged." },
    ]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw invalid();
  }
  const { t, i } = parsed as { t?: unknown; i?: unknown };
  if (typeof t !== "string" || typeof i !== "string" || !UUID.test(i)) {
    throw invalid();
  }
  const createdAt = new Date(t);
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== t) {
    throw invalid();
  }
  return { createdAt, id: i.toLowerCase() };
}

/**
 * The admin payment routes (ADR 0032 decisions 11, 13 and 18): the attempts of an order, refunds (`payments.refund`),
 * resync (one provider read now), the attention list and clearing an attention item (`payments.refund`, journaled with
 * the admin). The rules are the payment services'; this class checks that the attempt belongs to the order in the path
 * (a payment of another order is the same 404 as an unknown one) and shapes the answers. The view never carries the
 * page URL, the idempotency key or card data beyond the system and the last four digits.
 */
@Injectable()
export class AdminPaymentsService {
  private readonly logger = new Logger("Payments");

  constructor(
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(OrdersRepository) private readonly orders: OrdersRepository,
    @Inject(PaymentsRepository) private readonly payments: PaymentsRepository,
    @Inject(PaymentChanges) private readonly changes: PaymentChanges,
    @Inject(PaymentRefundsService) private readonly refunds: PaymentRefundsService,
    @Inject(PaymentReadsService) private readonly reads: PaymentReadsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** `GET /admin/orders/{id}/payments`. */
  async listForOrder(orderId: string): Promise<AdminPaymentList> {
    const order = await this.orders.findById(this.database, orderId);
    if (order === undefined) {
      throw notFound("Order");
    }
    const rows = await this.payments.listAttemptsOfOrder(this.database, order.id);
    return { items: await this.viewsOf(rows) };
  }

  /** `POST /admin/orders/{id}/payments/{paymentId}/refunds`. */
  async refund(
    orderId: string,
    paymentId: string,
    adminId: string | null,
    body: RefundPaymentBody,
    idempotencyKey: string | undefined,
  ): Promise<RefundAnswer> {
    const key = checkKey(idempotencyKey);
    const now = this.clock.now();
    const result = await this.refunds.requestAdminRefund({
      orderId,
      paymentId,
      adminId,
      amount: body.amount,
      note: body.note,
      idempotencyKey: key,
      now,
    });
    switch (result.kind) {
      case "not_found":
        throw notFound("Payment");
      case "idempotency_key_reused":
        throw idempotencyKeyReused();
      case "refused":
        if (result.reason === "invalid_amount") {
          throw validationFailed([{ path: "amount.amount", code: "invalid_amount" }]);
        }
        if (result.reason === "currency_mismatch") {
          throw validationFailed([{ path: "amount.currency", code: "currency_mismatch" }]);
        }
        throw ruleViolation(REFUSAL_DETAIL[result.reason], result.reason);
      case "requested":
        break;
    }
    if (!result.replay) {
      // After commit, with no transaction open: exactly once per claim (PaymentRefundsService); a lost answer is
      // `unknown` and never sent again. A failure here leaves the refund `requested` for job 11.
      await this.refunds.sendRefund(result.refund.id, now);
    }
    const refund = await this.payments.findRefund(this.database, result.refund.id);
    const row = await this.payments.findById(this.database, paymentId);
    if (refund === undefined || row === undefined) {
      throw new Error("A refund or its payment disappeared after it was requested");
    }
    return {
      status: result.replay ? 200 : 202,
      body: { refund: toAdminRefund(refund), payment: await this.viewOf(row) },
    };
  }

  /** `POST /admin/orders/{id}/payments/{paymentId}/resync`. */
  async resync(orderId: string, paymentId: string): Promise<AdminPayment> {
    const row = await this.attemptOfOrder(orderId, paymentId);
    const read = await this.reads.readNow(row);
    if (read.kind === "provider_not_enabled") {
      throw ruleViolation(
        "The provider of this payment is not enabled, so its status cannot be read.",
        "payment_not_available",
      );
    }
    if (read.kind === "provider_unavailable") {
      throw paymentProviderUnavailable(read.retryAfterSeconds ?? PAYMENT_RETRY_AFTER_SECONDS);
    }
    const fresh = (await this.payments.findById(this.database, row.id)) ?? row;
    return this.viewOf(fresh);
  }

  /** `GET /admin/payments`. */
  async list(query: ListAdminPaymentsQuery): Promise<AdminPaymentPage> {
    const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const rows = await this.payments.listPage(
      this.database,
      { needsAttention: query.needsAttention },
      after,
      query.limit + 1,
    );
    const page = rows.slice(0, query.limit);
    const views = await this.viewsOf(page.map((entry) => entry.payment));
    const last = page.at(-1);
    return {
      items: page.map((entry, index) => {
        const payment = views[index];
        if (payment === undefined) {
          throw new Error("A payment view is missing");
        }
        return { orderId: entry.payment.orderId, orderNumber: entry.orderNumber, payment };
      }),
      limit: query.limit,
      nextCursor:
        rows.length > query.limit && last !== undefined
          ? encodeCursor({ createdAt: last.payment.createdAt, id: last.payment.id })
          : null,
    };
  }

  /** `POST /admin/payments/{paymentId}/attention/clear`: idempotent; an attempt without an open item stays as it is. */
  async clearAttention(paymentId: string, adminId: string): Promise<AdminPayment> {
    const found = UUID.test(paymentId)
      ? await this.payments.findById(this.database, paymentId)
      : undefined;
    if (found === undefined) {
      throw notFound("Payment");
    }
    const row = await retryOnDeadlock(
      () =>
        withTransaction(this.database, async (tx) => {
          // The lock order of every payment write: the order row first, then the attempt.
          await this.orders.lockById(tx, found.orderId);
          const locked = await this.payments.lockById(tx, found.id);
          if (locked === undefined) {
            throw new Error("A payment attempt disappeared under its order lock");
          }
          return (await this.changes.clearAttention(tx, locked, adminId, this.clock.now())).row;
        }),
      (message) => this.logger.warn(message),
    );
    return this.viewOf(row);
  }

  private async attemptOfOrder(orderId: string, paymentId: string): Promise<PaymentRow> {
    const row = await this.payments.findById(this.database, paymentId);
    if (row === undefined || row.orderId !== orderId) {
      throw notFound("Payment");
    }
    return row;
  }

  private async viewOf(row: PaymentRow): Promise<AdminPayment> {
    const [view] = await this.viewsOf([row]);
    if (view === undefined) {
      throw new Error("A payment view is missing");
    }
    return view;
  }

  /** Two statements for any number of attempts (refunds, journals). */
  private async viewsOf(rows: readonly PaymentRow[]): Promise<AdminPayment[]> {
    const ids = rows.map((row) => row.id);
    const refunds = await this.payments.listRefundsOfPayments(this.database, ids);
    const events = await this.payments.listEventsOfPayments(this.database, ids);
    return toAdminPayments(rows, refunds, events);
  }
}

/** The `Idempotency-Key` header is required and a UUID (the checkout's rule); compared in lower case. */
function checkKey(idempotencyKey: string | undefined): string {
  if (idempotencyKey === undefined) {
    throw validationFailed([{ path: "Idempotency-Key", code: "idempotency_key_required" }]);
  }
  if (!UUID.test(idempotencyKey)) {
    throw validationFailed([{ path: "Idempotency-Key", code: "invalid_idempotency_key" }]);
  }
  return idempotencyKey.toLowerCase();
}
