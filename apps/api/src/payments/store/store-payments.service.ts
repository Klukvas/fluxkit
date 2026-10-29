import { Inject, Injectable } from "@nestjs/common";
import { parseOrderNumber } from "@fluxkit/core";
import { CLOCK, type Clock } from "../../auth/clock.js";
import { StoreService } from "../../catalog/store/store.service.js";
import {
  idempotencyKeyReused,
  notFound,
  paymentProviderUnavailable,
  ruleViolation,
  validationFailed,
} from "../../common/problem.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { OrdersRepository, type OrderRow } from "../../orders/orders.repository.js";
import { OrdersService } from "../../orders/orders.service.js";
import { PaymentsRepository, type PaymentRow } from "../attempts/payments.repository.js";
import { PaymentCreateService, type CreatePaymentRefusal } from "../payment-create.service.js";
import { PaymentReadsService } from "../payment-reads.service.js";
import { shopperViewOf, StorePaymentViews } from "./store-payment-views.js";
import type {
  CustomerCreatePaymentBody,
  GuestCreatePaymentBody,
  StoreCreatedPayment,
  StorePaymentStatus,
} from "./store-payments.schemas.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `Retry-After` of `503 payment_provider_unavailable` when the provider names none (ADR 0032 open question 7: a constant
 * in the API, no variable).
 */
export const PAYMENT_RETRY_AFTER_SECONDS = 30;

const REFUSAL_DETAIL: Readonly<Record<CreatePaymentRefusal, string>> = {
  order_not_payable: "This order can no longer be paid.",
  payment_in_progress:
    "A payment of this order is in progress. Wait until it is confirmed or declined.",
  payment_window_too_short: "Too little time is left to pay this order online.",
  payment_not_available: "Online payment is not available for this order.",
};

export interface CreatedPaymentAnswer {
  /** `201` for a new attempt, `200` for a replay of the same `Idempotency-Key`. */
  readonly status: 200 | 201;
  readonly body: StoreCreatedPayment;
}

/**
 * The store payment routes (ADR 0032 decisions 6 and 18): who may act on which order (exactly the rules of the order
 * lookup and cancel: one identical `404` for an unknown number, a wrong or expired token, a customer's order asked as a
 * guest and another customer's order) and the shopper-facing answers. The create flow itself is `PaymentCreateService`
 * (amount = the order total under the order lock, never from the client); the shopper never sees a provider status, a
 * provider code or a provider id.
 */
@Injectable()
export class StorePaymentsService {
  constructor(
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(OrdersRepository) private readonly orders: OrdersRepository,
    @Inject(OrdersService) private readonly orderService: OrdersService,
    @Inject(StoreService) private readonly store: StoreService,
    @Inject(PaymentsRepository) private readonly payments: PaymentsRepository,
    @Inject(PaymentCreateService) private readonly create: PaymentCreateService,
    @Inject(PaymentReadsService) private readonly reads: PaymentReadsService,
    @Inject(StorePaymentViews) private readonly views: StorePaymentViews,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** `POST /store/orders/payments`. */
  async createAsGuest(
    body: GuestCreatePaymentBody,
    idempotencyKey: string | undefined,
  ): Promise<CreatedPaymentAnswer> {
    const key = this.checkKey(idempotencyKey);
    this.validateLocale(body.locale);
    const order = await this.guestOrder(body.number, body.accessToken);
    return this.createFor(order, key, "guest", body);
  }

  /** `POST /store/account/orders/{number}/payments`. */
  async createAsCustomer(
    customerId: string,
    number: string,
    body: CustomerCreatePaymentBody,
    idempotencyKey: string | undefined,
  ): Promise<CreatedPaymentAnswer> {
    const key = this.checkKey(idempotencyKey);
    this.validateLocale(body.locale);
    const order = await this.customerOrder(customerId, number);
    return this.createFor(order, key, "customer", body);
  }

  /** `POST /store/orders/payments/status`. */
  async statusAsGuest(
    number: string,
    accessToken: string,
    paymentId: string,
  ): Promise<StorePaymentStatus> {
    const order = await this.guestOrder(number, accessToken);
    return this.statusFor(order, paymentId);
  }

  /** `GET /store/account/orders/{number}/payments/{paymentId}`. */
  async statusAsCustomer(
    customerId: string,
    number: string,
    paymentId: string,
  ): Promise<StorePaymentStatus> {
    const order = await this.customerOrder(customerId, number);
    return this.statusFor(order, paymentId);
  }

  private async createFor(
    order: OrderRow,
    idempotencyKey: string,
    createdBy: "guest" | "customer",
    body: { readonly provider?: string; readonly locale?: string },
  ): Promise<CreatedPaymentAnswer> {
    const result = await this.create.createPaymentForOrder({
      orderId: order.id,
      idempotencyKey,
      createdBy,
      locale: body.locale ?? null,
      providerCode: body.provider ?? null,
    });
    switch (result.kind) {
      case "not_found":
        throw notFound("Order");
      case "refused":
        throw ruleViolation(REFUSAL_DETAIL[result.rule], result.rule);
      case "idempotency_key_reused":
        throw idempotencyKeyReused();
      case "created": {
        const row = await this.attempt(result.payment.paymentId);
        return { status: result.replay ? 200 : 201, body: this.createdView(row) };
      }
      case "provider_unavailable": {
        const row = await this.attempt(result.payment.paymentId);
        const fresh = (await this.orders.findById(this.database, order.id)) ?? order;
        const attempts = await this.payments.listAttemptsOfOrder(this.database, order.id);
        const canRetry = this.views.canPay(fresh, attempts);
        throw paymentProviderUnavailable(this.retryAfter(row, result.retryAfterSeconds, canRetry), {
          paymentId: row.id,
          status: shopperViewOf(row).status,
          canRetry,
        });
      }
    }
  }

  /**
   * When asking again makes sense. A failed create (nothing was made, or the provider refused): the provider's
   * `Retry-After`, else the constant. A lost create answer (`create_unknown`, never retried): no new attempt is accepted
   * until the reconcile job closes the attempt at its invoice end, so `Retry-After` is the time until then (the shopper
   * waits; a webhook may still bind the invoice and pay the order meanwhile).
   */
  private retryAfter(row: PaymentRow, providerSeconds: number | null, canRetry: boolean): number {
    if (canRetry) {
      return providerSeconds ?? PAYMENT_RETRY_AFTER_SECONDS;
    }
    const untilEnd = Math.ceil((row.expiresAt.getTime() - this.clock.now().getTime()) / 1_000);
    return Math.max(PAYMENT_RETRY_AFTER_SECONDS, providerSeconds ?? 0, untilEnd);
  }

  private createdView(row: PaymentRow): StoreCreatedPayment {
    const view = shopperViewOf(row);
    return {
      paymentId: row.id,
      status: view.status,
      redirectUrl: view.status === "waiting" ? row.redirectUrl : null,
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  private async statusFor(order: OrderRow, paymentId: string): Promise<StorePaymentStatus> {
    const row = UUID.test(paymentId)
      ? await this.payments.findById(this.database, paymentId)
      : undefined;
    if (row === undefined || row.orderId !== order.id) {
      throw notFound("Payment");
    }
    // The query parameter of the return page only says WHICH attempt to show; the state is ours, read from the
    // provider when it may have moved (decision 6).
    const refreshed = await this.reads.refreshForShopper(row);
    const fresh = (await this.orders.findById(this.database, order.id)) ?? order;
    return this.views.statusView(this.database, fresh, refreshed);
  }

  private async attempt(paymentId: string): Promise<PaymentRow> {
    const row = await this.payments.findById(this.database, paymentId);
    if (row === undefined) {
      throw new Error("A payment attempt the create flow answered does not exist");
    }
    return row;
  }

  /** Exactly the lookup's rule: one hash comparison, also for a malformed or unknown number. */
  private async guestOrder(number: string, accessToken: string): Promise<OrderRow> {
    const parsed = parseOrderNumber(number);
    const order = parsed.ok
      ? await this.orders.findByNumber(this.database, parsed.number)
      : undefined;
    if (
      !this.orderService.guestMayOpen(order, accessToken, this.clock.now()) ||
      order === undefined
    ) {
      throw notFound("Order");
    }
    return order;
  }

  /** The owner filter is in SQL: another customer's number is the same 404 as an unknown one. */
  private async customerOrder(customerId: string, number: string): Promise<OrderRow> {
    const parsed = parseOrderNumber(number);
    const order = parsed.ok
      ? await this.orders.findByNumberOfCustomer(this.database, parsed.number, customerId)
      : undefined;
    if (order === undefined) {
      throw notFound("Order");
    }
    return order;
  }

  /** The `Idempotency-Key` header is required and a UUID (the checkout's rule); compared in lower case. */
  private checkKey(idempotencyKey: string | undefined): string {
    if (idempotencyKey === undefined) {
      throw validationFailed([{ path: "Idempotency-Key", code: "idempotency_key_required" }]);
    }
    if (!UUID.test(idempotencyKey)) {
      throw validationFailed([{ path: "Idempotency-Key", code: "invalid_idempotency_key" }]);
    }
    return idempotencyKey.toLowerCase();
  }

  /** Checked before anything is looked up, so a bad locale never depends on whether the order exists. */
  private validateLocale(requested: string | undefined): void {
    if (requested !== undefined) {
      this.store.resolveLocale(requested);
    }
  }
}
