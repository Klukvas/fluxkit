import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { PaymentWebhookInput } from "@fluxkit/core";
import { DEFAULT_JOB_LIMITS } from "../common/job-limits.js";
import { reconcilePayments, type ReconcilePaymentsResult } from "../jobs/reconcile-payments.job.js";
import type { JobBudget } from "../jobs/job-budget.js";
import { OrdersService } from "../orders/orders.service.js";
import {
  PaymentCreateService,
  type CreatePaymentResult,
} from "../payments/payment-create.service.js";
import { PaymentFactsService } from "../payments/payment-facts.service.js";
import { PaymentReconcileService } from "../payments/payment-reconcile.service.js";
import { PaymentRefundsService } from "../payments/payment-refunds.service.js";
import { PaymentProviderRegistry } from "../payments/registry/index.js";
import type { StartAppOptions, RunningApp } from "./app.js";
import { AdminOrdersWorld, type PlaceLine, type PlacedForAdmin } from "./admin-orders-world.js";
import { FakeClock } from "./fake-clock.js";
import {
  TEST_PAYMENT_PROVIDER_CODE,
  testPaymentProviders,
  type TestPaymentProvider,
} from "./test-payment-provider.js";

/** TEST ONLY. Shared by the payment specs (payments plan step 5). */

export interface PaymentRowForTest {
  id: string;
  order_id: string;
  provider_code: string;
  provider_payment_id: string | null;
  amount: number;
  currency: string;
  status: string;
  provider_status: string | null;
  provider_modified_at: Date | null;
  final_amount: number | null;
  refunded_amount: number;
  redirect_url: string | null;
  expires_at: Date;
  order_outcome: string | null;
  needs_attention: boolean;
  attention_code: string | null;
  failure_code: string | null;
  card_system: string | null;
  card_last4: string | null;
  next_check_at: Date | null;
  check_attempts: number;
  idempotency_key: string | null;
  created_by: string;
}

export interface PaymentEventRowForTest {
  source: string;
  dedupe_key: string | null;
  provider_status: string | null;
  applied: boolean;
  from_status: string | null;
  to_status: string | null;
  actor_admin_id: string | null;
}

export interface RefundRowForTest {
  id: string;
  payment_id: string;
  amount: number;
  status: string;
  reason: string;
  failure_code: string | null;
  note: string | null;
}

/**
 * TEST ONLY. The admin order world with the in-repo test payment provider mounted in every app, a fake clock that starts
 * at the real time (the database stamps rows with its own clock too) and direct handles on the payment services, the
 * webhook route and job 11. Every order is placed through the real checkout.
 */
export class PaymentWorld {
  private constructor(
    readonly orders: AdminOrdersWorld,
    readonly clock: FakeClock,
  ) {}

  static async start(options: StartAppOptions = {}): Promise<PaymentWorld> {
    const clock = new FakeClock(new Date());
    const orders = await AdminOrdersWorld.start({
      clock,
      extraPaymentProviders: testPaymentProviders(),
      paymentCallTimeoutMs: 500,
      ...options,
    });
    return new PaymentWorld(orders, clock);
  }

  get pool() {
    return this.orders.pool;
  }

  get app(): RunningApp {
    return this.orders.owner;
  }

  /** The test provider inside one of the apps (each app has its own instance). */
  provider(running: RunningApp = this.orders.owner): TestPaymentProvider {
    return running.app
      .get(PaymentProviderRegistry)
      .get(TEST_PAYMENT_PROVIDER_CODE) as TestPaymentProvider;
  }

  resetProvider(): void {
    for (const running of [
      this.orders.owner,
      this.orders.manager,
      this.orders.viewer,
      this.orders.anonymous,
    ]) {
      this.provider(running).reset();
    }
  }

  get createService(): PaymentCreateService {
    return this.app.app.get(PaymentCreateService);
  }

  get facts(): PaymentFactsService {
    return this.app.app.get(PaymentFactsService);
  }

  get refunds(): PaymentRefundsService {
    return this.app.app.get(PaymentRefundsService);
  }

  get reconcile(): PaymentReconcileService {
    return this.app.app.get(PaymentReconcileService);
  }

  get orderService(): OrdersService {
    return this.app.app.get(OrdersService);
  }

  place(lines: PlaceLine[] = [{ quantity: 1 }]): Promise<PlacedForAdmin> {
    return this.orders.place(lines);
  }

  create(
    placed: { id: string },
    options: { key?: string; createdBy?: "customer" | "guest"; locale?: string | null } = {},
  ): Promise<CreatePaymentResult> {
    return this.createService.createPaymentForOrder({
      orderId: placed.id,
      idempotencyKey: options.key ?? randomUUID(),
      createdBy: options.createdBy ?? "guest",
      locale: options.locale ?? null,
    });
  }

  /** Creates an attempt the provider accepted; answers the attempt id and the provider's invoice id. */
  async created(placed: { id: string }): Promise<{ paymentId: string; invoiceId: string }> {
    const result = await this.create(placed);
    expect(result.kind, JSON.stringify(result)).toBe("created");
    if (result.kind !== "created") {
      throw new Error("not created");
    }
    const row = await this.payment(result.payment.paymentId);
    expect(row.status).toBe("awaiting_customer");
    return { paymentId: row.id, invoiceId: row.provider_payment_id ?? "" };
  }

  /** Posts a webhook to the real route with exactly these bytes and headers. */
  async webhook(
    input: PaymentWebhookInput,
    options: { provider?: string; running?: RunningApp; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; text: string }> {
    const running = options.running ?? this.app;
    const response = await fetch(
      `${running.baseUrl}/webhooks/payments/${options.provider ?? TEST_PAYMENT_PROVIDER_CODE}`,
      {
        method: "POST",
        headers: { ...input.headers, ...options.headers },
        body: Buffer.from(input.rawBody),
      },
    );
    return { status: response.status, text: await response.text() };
  }

  /** Sends the signed webhook of the invoice's current state; expects 200. */
  async notify(invoiceId: string): Promise<void> {
    const answer = await this.webhook(this.provider().webhookFor(invoiceId));
    expect(answer.status, answer.text).toBe(200);
  }

  /** Runs job 11 once at the world's clock (or `now`). */
  job11(
    now: Date = this.clock.now(),
    options: { budget?: JobBudget; batchSize?: number; maxBatches?: number } = {},
  ): Promise<ReconcilePaymentsResult> {
    return reconcilePayments({ reconcile: this.reconcile }, now, {
      budget: options.budget,
      limits: { batchSize: options.batchSize ?? 50, maxBatches: options.maxBatches ?? 10 },
      jobLimits: DEFAULT_JOB_LIMITS,
    });
  }

  async payment(id: string): Promise<PaymentRowForTest> {
    const result = await this.pool.query<PaymentRowForTest>(
      "select *, amount::int as amount, refunded_amount::int as refunded_amount, final_amount::int as final_amount from payment where id = $1",
      [id],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("no such payment");
    }
    return row;
  }

  async paymentsOf(orderId: string): Promise<PaymentRowForTest[]> {
    const result = await this.pool.query<PaymentRowForTest>(
      "select *, amount::int as amount, refunded_amount::int as refunded_amount, final_amount::int as final_amount from payment where order_id = $1 order by created_at, id",
      [orderId],
    );
    return result.rows;
  }

  async eventsOf(paymentId: string): Promise<PaymentEventRowForTest[]> {
    const result = await this.pool.query<PaymentEventRowForTest>(
      `select source, dedupe_key, provider_status, applied, from_status, to_status, actor_admin_id
         from payment_event where payment_id = $1 order by created_at, id`,
      [paymentId],
    );
    return result.rows;
  }

  async refundsOf(paymentId: string): Promise<RefundRowForTest[]> {
    const result = await this.pool.query<RefundRowForTest>(
      "select id, payment_id, amount::int as amount, status, reason, failure_code, note from payment_refund where payment_id = $1 order by created_at, id",
      [paymentId],
    );
    return result.rows;
  }

  async orderStatus(
    orderId: string,
  ): Promise<{ status: string; payment_reference: string | null; expires_at: Date }> {
    const result = await this.pool.query<{
      status: string;
      payment_reference: string | null;
      expires_at: Date;
    }>("select status, payment_reference, expires_at from sales_order where id = $1", [orderId]);
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("no such order");
    }
    return row;
  }

  /** The `domain_event` types written for an aggregate (an order, a payment or a refund), oldest first. */
  async eventTypes(aggregateId: string): Promise<string[]> {
    const result = await this.pool.query<{ type: string }>(
      "select type from domain_event where aggregate_id = $1 order by created_at, id",
      [aggregateId],
    );
    return result.rows.map((row) => row.type);
  }

  async stop(): Promise<void> {
    await this.orders.stop();
  }
}
