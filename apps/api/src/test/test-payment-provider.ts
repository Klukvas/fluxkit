import { Injectable, Module, SetMetadata, type Type } from "@nestjs/common";
import {
  CURRENCY_CODES,
  PAYMENT_PROVIDER_METADATA,
  paymentProviderFailure,
  paymentProviderMetadata,
  paymentProviderOk,
  type CreatePaymentInput,
  type Money,
  type PaymentCreated,
  type PaymentProviderFailure,
  type PaymentProviderFailureReason,
  type PaymentProviderPort,
  type PaymentProviderResult,
  type PaymentWebhookInput,
  type ProviderAbortSignal,
  type ProviderPaymentFact,
  type ProviderPaymentStatus,
  type ProviderRefundStatus,
  type RefundInput,
} from "@fluxkit/core";
import type { LoadedPaymentProvider } from "../payments/registry/index.js";

/**
 * Code of the in-repo test payment provider. Specs mount it with `startApp({ extraPaymentProviders: testPaymentProviders() })`,
 * so core and API specs need nothing from `packages/providers` (the package `_fake-payment` has its own specs and the richer
 * hooks). It is deliberately smaller than the package: it keeps every invoice in memory, changes status when a spec says so,
 * answers a fact for `getPayment`, accepts one documented webhook signature (`TEST_PAYMENT_SIGNATURE` in the
 * `x-test-signature` header) and fails on request. Create is not idempotent (Monobank M5); a refund is deduplicated by its id.
 */
export const TEST_PAYMENT_PROVIDER_CODE = "fake";

/** The only webhook header this provider checks, and the value it accepts. A spec builds a webhook with `webhookFor`. */
export const TEST_PAYMENT_SIGNATURE_HEADER = "x-test-signature";
export const TEST_PAYMENT_SIGNATURE = "test-signature-ok";

export interface TestPaymentFailure {
  /** Default `unavailable`. */
  reason?: PaymentProviderFailureReason;
  providerCodes?: readonly string[];
  retryAfterSeconds?: number;
  /** How many calls fail (any of create, read, invalidate, refund). Default 1. */
  times?: number;
  /** The effect HAPPENS (an invoice is created, a refund recorded) but the answer is lost. */
  afterEffect?: boolean;
  /** The call never answers until its abort signal fires, then rejects with the signal's reason (a timeout). */
  hang?: boolean;
  /** The call rejects instead of answering a result. */
  throws?: boolean;
}

export interface TestInvoice {
  readonly providerPaymentId: string;
  readonly reference: string;
  readonly amount: Money;
  status: ProviderPaymentStatus;
  modifiedAt: Date;
  readonly refunds: { refundId: string; amount: Money; status: ProviderRefundStatus }[];
}

interface Planned {
  readonly failure: PaymentProviderFailure;
  readonly afterEffect: boolean;
  readonly hang: boolean;
  readonly throws: boolean;
  remaining: number;
}

const RAW: Record<ProviderPaymentStatus, string> = {
  created: "created",
  processing: "processing",
  authorized: "hold",
  succeeded: "success",
  failed: "failure",
  reversed: "reversed",
  expired: "expired",
};

/** Keeps every invoice in memory and fails on request. Reach it with `app.get(TestPaymentProvider)`. */
@Injectable()
@SetMetadata(PAYMENT_PROVIDER_METADATA, paymentProviderMetadata(TEST_PAYMENT_PROVIDER_CODE))
export class TestPaymentProvider implements PaymentProviderPort {
  readonly code = TEST_PAYMENT_PROVIDER_CODE;
  readonly capabilities = Object.freeze({
    currencies: Object.freeze([...CURRENCY_CODES]),
    partialRefunds: true,
    multipleRefunds: true,
    invalidateUnpaid: true,
    webhooks: true,
  });

  /** Invoices in creation order. */
  readonly invoices: TestInvoice[] = [];
  /** `createPayment` inputs, oldest first (failed calls included). */
  readonly creates: CreatePaymentInput[] = [];
  /** Every refund request, oldest first (replays and failures included). */
  readonly refundCalls: RefundInput[] = [];
  private planned: Planned | undefined;
  private tick = 0;

  failNext(failure: TestPaymentFailure = {}): void {
    this.planned = {
      failure: paymentProviderFailure(failure.reason ?? "unavailable", {
        providerCodes: failure.providerCodes,
        ...(failure.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: failure.retryAfterSeconds }),
      }),
      afterEffect: failure.afterEffect === true,
      hang: failure.hang === true,
      throws: failure.throws === true,
      remaining: failure.times ?? 1,
    };
  }

  reset(): void {
    this.invoices.length = 0;
    this.creates.length = 0;
    this.refundCalls.length = 0;
    this.planned = undefined;
    this.tick = 0;
  }

  /** `created`/`processing` -> `succeeded` (or any other status a spec needs): the provider says the payment changed. */
  setStatus(providerPaymentId: string, status: ProviderPaymentStatus): void {
    const invoice = this.find(providerPaymentId);
    invoice.status = status;
    invoice.modifiedAt = this.now();
  }

  /** A correctly signed webhook about the invoice's current state. */
  webhookFor(providerPaymentId: string): PaymentWebhookInput {
    const invoice = this.find(providerPaymentId);
    const body = JSON.stringify({ invoiceId: invoice.providerPaymentId });
    return {
      headers: { [TEST_PAYMENT_SIGNATURE_HEADER]: TEST_PAYMENT_SIGNATURE },
      rawBody: new TextEncoder().encode(body),
    };
  }

  createPayment(
    input: CreatePaymentInput,
    signal: ProviderAbortSignal,
  ): Promise<PaymentProviderResult<PaymentCreated>> {
    if (signal.aborted) {
      return Promise.resolve(paymentProviderFailure("not_sent"));
    }
    this.creates.push(input);
    return this.run(signal, () => {
      const providerPaymentId = `test-pay-${String(this.invoices.length + 1).padStart(6, "0")}`;
      this.invoices.push({
        providerPaymentId,
        reference: input.paymentId,
        amount: input.amount,
        status: "created",
        modifiedAt: this.now(),
        refunds: [],
      });
      return paymentProviderOk({
        providerPaymentId,
        redirectUrl: `https://pay.test.invalid/${providerPaymentId}`,
      });
    });
  }

  getPayment(
    providerPaymentId: string,
    signal: ProviderAbortSignal,
  ): Promise<PaymentProviderResult<ProviderPaymentFact>> {
    if (signal.aborted) {
      return Promise.resolve(paymentProviderFailure("not_sent"));
    }
    return this.run(signal, () => {
      const invoice = this.invoices.find((entry) => entry.providerPaymentId === providerPaymentId);
      return invoice === undefined
        ? paymentProviderFailure("not_found")
        : paymentProviderOk(this.factOf(invoice));
    });
  }

  invalidatePayment(
    providerPaymentId: string,
    signal: ProviderAbortSignal,
  ): Promise<PaymentProviderResult<{ invalidated: boolean }>> {
    if (signal.aborted) {
      return Promise.resolve(paymentProviderFailure("not_sent"));
    }
    return this.run(signal, () => {
      const invoice = this.invoices.find((entry) => entry.providerPaymentId === providerPaymentId);
      if (invoice === undefined) {
        return paymentProviderFailure("not_found");
      }
      if (invoice.status === "succeeded") {
        return paymentProviderFailure("not_cancellable", { providerCodes: ["already_paid"] });
      }
      invoice.status = "expired";
      invoice.modifiedAt = this.now();
      return paymentProviderOk({ invalidated: true });
    });
  }

  refund(
    input: RefundInput,
    signal: ProviderAbortSignal,
  ): Promise<PaymentProviderResult<{ status: ProviderRefundStatus }>> {
    if (signal.aborted) {
      return Promise.resolve(paymentProviderFailure("not_sent"));
    }
    this.refundCalls.push(input);
    return this.run(signal, () => {
      const invoice = this.invoices.find(
        (entry) => entry.providerPaymentId === input.providerPaymentId,
      );
      if (invoice === undefined) {
        return paymentProviderFailure("not_found");
      }
      const known = invoice.refunds.find((entry) => entry.refundId === input.refundId);
      if (known !== undefined) {
        return paymentProviderOk({ status: known.status });
      }
      if (invoice.status !== "succeeded") {
        return paymentProviderFailure("not_cancellable", { providerCodes: ["not_paid"] });
      }
      invoice.refunds.push({ refundId: input.refundId, amount: input.amount, status: "succeeded" });
      invoice.modifiedAt = this.now();
      return paymentProviderOk({ status: "succeeded" as const });
    });
  }

  verifyWebhook(
    input: PaymentWebhookInput,
    signal: ProviderAbortSignal,
  ): Promise<PaymentProviderResult<ProviderPaymentFact>> {
    if (signal.aborted) {
      return Promise.resolve(paymentProviderFailure("not_sent"));
    }
    if (input.headers[TEST_PAYMENT_SIGNATURE_HEADER] !== TEST_PAYMENT_SIGNATURE) {
      return Promise.resolve(paymentProviderFailure("invalid_signature"));
    }
    try {
      const body = JSON.parse(new TextDecoder().decode(input.rawBody)) as { invoiceId?: unknown };
      const invoice = this.invoices.find((entry) => entry.providerPaymentId === body.invoiceId);
      return Promise.resolve(
        invoice === undefined
          ? paymentProviderFailure("not_found")
          : paymentProviderOk(this.factOf(invoice)),
      );
    } catch {
      return Promise.resolve(
        paymentProviderFailure("rejected", { providerCodes: ["malformed_body"] }),
      );
    }
  }

  private find(providerPaymentId: string): TestInvoice {
    const invoice = this.invoices.find((entry) => entry.providerPaymentId === providerPaymentId);
    if (invoice === undefined) {
      throw new RangeError("unknown test invoice");
    }
    return invoice;
  }

  private now(): Date {
    this.tick += 1;
    return new Date(Date.UTC(2026, 0, 1) + this.tick * 1000);
  }

  private factOf(invoice: TestInvoice): ProviderPaymentFact {
    const refunded = invoice.refunds.reduce((sum, entry) => sum + entry.amount.amount, 0);
    return {
      providerPaymentId: invoice.providerPaymentId,
      reference: invoice.reference,
      status: invoice.status,
      providerStatus: RAW[invoice.status],
      amount: invoice.amount,
      finalAmount:
        invoice.status === "succeeded"
          ? { amount: invoice.amount.amount - refunded, currency: invoice.amount.currency }
          : null,
      modifiedAt: invoice.modifiedAt,
      failureCode: null,
      refunds: invoice.refunds.map((entry) => ({
        refundId: entry.refundId,
        status: entry.status,
        amount: entry.amount,
        modifiedAt: invoice.modifiedAt,
      })),
      card: invoice.status === "succeeded" ? { system: "visa", last4: "4242" } : null,
    };
  }

  private take(): Planned | undefined {
    const planned = this.planned;
    if (planned === undefined) {
      return undefined;
    }
    planned.remaining -= 1;
    if (planned.remaining <= 0) {
      this.planned = undefined;
    }
    return planned;
  }

  private run<T>(
    signal: ProviderAbortSignal,
    effect: () => PaymentProviderResult<T>,
  ): Promise<PaymentProviderResult<T>> {
    const planned = this.take();
    if (planned?.hang === true) {
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }
    if (planned?.throws === true) {
      return Promise.reject(new Error("test provider failure carrying card 4242424242424242"));
    }
    if (planned !== undefined && !planned.afterEffect) {
      return Promise.resolve(planned.failure);
    }
    const answer = effect();
    return Promise.resolve(planned === undefined ? answer : planned.failure);
  }
}

@Module({ providers: [TestPaymentProvider], exports: [TestPaymentProvider] })
class TestPaymentProviderModule {}

/** The in-repo test payment provider as a loaded module: `startApp({ extraPaymentProviders: testPaymentProviders() })`. */
export function testPaymentProviders(): LoadedPaymentProvider[] {
  return [{ code: TEST_PAYMENT_PROVIDER_CODE, module: TestPaymentProviderModule as Type<unknown> }];
}
