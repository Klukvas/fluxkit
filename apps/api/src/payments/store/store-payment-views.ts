import { Inject, Injectable } from "@nestjs/common";
import {
  decideNewPaymentAttempt,
  PAYMENT_ORDER_OUTCOMES,
  shopperPaymentStatus,
  type OrderStatus,
  type PaymentOrderOutcome,
  type ShopperPaymentView,
} from "@fluxkit/core";
import { CLOCK, type Clock } from "../../auth/clock.js";
import type { DbExecutor } from "../../common/transaction.js";
import { paymentStatusOf } from "../attempts/payment-changes.js";
import { PaymentsRepository, type PaymentRow } from "../attempts/payments.repository.js";
import { PAYMENTS_CONFIG, type PaymentsConfig } from "../payments-config.js";
import { PaymentProviderRegistry } from "../registry/index.js";

/** What the payment views need of an order. */
export interface PaymentOrderFacts {
  readonly id: string;
  readonly status: string;
  readonly currency: string;
  readonly expiresAt: Date;
}

/** The `payment` member of the store order views (ADR 0032 decision 18). */
export interface StoreOrderPaymentView {
  readonly canPay: boolean;
  readonly providers: string[];
  readonly latest: {
    readonly paymentId: string;
    readonly status: ShopperPaymentView["status"];
    readonly failureCategory: ShopperPaymentView["failureCategory"];
    readonly expiresAt: string;
    readonly redirectUrl: string | null;
  } | null;
}

/** The answer of the store status routes (ADR 0032 decision 18). */
export interface StorePaymentStatusView {
  readonly paymentId: string;
  readonly status: ShopperPaymentView["status"];
  readonly failureCategory: ShopperPaymentView["failureCategory"];
  readonly expiresAt: string;
  readonly orderStatus: OrderStatus;
  readonly canRetry: boolean;
}

function outcomeOf(value: string | null): PaymentOrderOutcome | null {
  if (value === null) {
    return null;
  }
  if (!PAYMENT_ORDER_OUTCOMES.includes(value as PaymentOrderOutcome)) {
    throw new RangeError(`A payment attempt has an unknown order outcome: ${value}`);
  }
  return value as PaymentOrderOutcome;
}

/** The shopper's view of one stored attempt (core `shopperPaymentStatus`): never a provider status, code or id. */
export function shopperViewOf(row: PaymentRow): ShopperPaymentView {
  return shopperPaymentStatus({
    status: paymentStatusOf(row.status),
    hasInvoice: row.providerPaymentId !== null,
    failureCode: row.failureCode,
    orderOutcome: outcomeOf(row.orderOutcome),
  });
}

/**
 * The shopper-facing payment views of an order (store order views, store status routes). Reads only. Whether a new
 * attempt is possible is core `decideNewPaymentAttempt`, the same rule the create route applies under its lock (the view
 * may be stale by the time the shopper acts; the create route decides again).
 */
@Injectable()
export class StorePaymentViews {
  constructor(
    @Inject(PaymentsRepository) private readonly payments: PaymentsRepository,
    @Inject(PaymentProviderRegistry) private readonly registry: PaymentProviderRegistry,
    @Inject(PAYMENTS_CONFIG) private readonly config: PaymentsConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * The enabled providers that take the currency. None without `STOREFRONT_PUBLIC_URL`: no return or webhook URL can be
   * built, so no attempt can be created (`payment_not_available`).
   */
  providersFor(currency: string): string[] {
    if (this.config.storefrontPublicUrl === null) {
      return [];
    }
    return this.registry
      .list()
      .filter((provider) => provider.capabilities.currencies.includes(currency))
      .map((provider) => provider.code);
  }

  /** Whether the create route would start a new attempt now (no lock: a hint for the shopper's page). */
  canPay(order: PaymentOrderFacts, attempts: readonly PaymentRow[]): boolean {
    return decideNewPaymentAttempt({
      orderStatus: order.status as OrderStatus,
      attempts: attempts.map((attempt) => ({
        id: attempt.id,
        status: paymentStatusOf(attempt.status),
      })),
      providerAvailable: this.providersFor(order.currency).length > 0,
      now: this.clock.now(),
      orderExpiresAt: order.expiresAt,
    }).ok;
  }

  /** The `payment` member of a store order view; `db` may be the caller's transaction. */
  async orderPayment(db: DbExecutor, order: PaymentOrderFacts): Promise<StoreOrderPaymentView> {
    const attempts = await this.payments.listAttemptsOfOrder(db, order.id);
    const latest = attempts.at(-1);
    return {
      canPay: this.canPay(order, attempts),
      providers: this.providersFor(order.currency),
      latest:
        latest === undefined
          ? null
          : (() => {
              const view = shopperViewOf(latest);
              return {
                paymentId: latest.id,
                status: view.status,
                failureCategory: view.failureCategory,
                expiresAt: latest.expiresAt.toISOString(),
                redirectUrl: view.status === "waiting" ? latest.redirectUrl : null,
              };
            })(),
    };
  }

  /** The answer of the store status routes for one attempt of the order. */
  async statusView(
    db: DbExecutor,
    order: PaymentOrderFacts,
    row: PaymentRow,
  ): Promise<StorePaymentStatusView> {
    const view = shopperViewOf(row);
    const attempts = await this.payments.listAttemptsOfOrder(db, order.id);
    return {
      paymentId: row.id,
      status: view.status,
      failureCategory: view.failureCategory,
      expiresAt: row.expiresAt.toISOString(),
      orderStatus: order.status as OrderStatus,
      canRetry: this.canPay(order, attempts),
    };
  }
}
