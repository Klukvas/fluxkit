import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
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
 * so core and API specs need nothing from `packages/providers` (the package `_fake-payment` has its own specs). It follows
 * the documented Monobank facts the API must survive: create is NOT idempotent (M5), a refund IS deduplicated by our
 * refund id (M13, assumed), facts carry a `modifiedAt` from a logical clock (M10), and a webhook body is the status
 * answer, signed over its exact bytes (M8, M12; the scheme here is HMAC-SHA256, not Monobank's ECDSA). Everything is in
 * memory and changes only when a spec says so.
 */
export const TEST_PAYMENT_PROVIDER_CODE = "fake";

/** The webhook signature header: lower-case hex HMAC-SHA256 of the raw body with `TEST_PAYMENT_WEBHOOK_KEY`. */
export const TEST_PAYMENT_SIGNATURE_HEADER = "x-test-signature";
export const TEST_PAYMENT_WEBHOOK_KEY = "fluxkit-test-payment-webhook-key";

export type TestPaymentOperation =
  "createPayment" | "getPayment" | "invalidatePayment" | "refund" | "verifyWebhook";

const OPERATIONS: readonly TestPaymentOperation[] = [
  "createPayment",
  "getPayment",
  "invalidatePayment",
  "refund",
  "verifyWebhook",
];

export interface TestPaymentFailure {
  /** Which call fails; default the next `createPayment`, `getPayment`, `invalidatePayment` or `refund`. */
  operation?: TestPaymentOperation;
  /** Default `unavailable`. */
  reason?: PaymentProviderFailureReason;
  providerCodes?: readonly string[];
  retryAfterSeconds?: number;
  /** How many matching calls fail. Default 1. */
  times?: number;
  /** The effect HAPPENS (an invoice is created, a refund recorded, an invoice invalidated) but the answer is lost. */
  afterEffect?: boolean;
  /** The call never answers until its abort signal fires, then rejects with the signal's reason (a timeout). */
  hang?: boolean;
  /** The call rejects instead of answering a result; the error message carries card-like text a log must not show. */
  throws?: boolean;
}

export interface TestRefund {
  readonly refundId: string | null;
  readonly amount: Money;
  status: ProviderRefundStatus;
  modifiedAt: Date;
}

export interface TestInvoice {
  readonly providerPaymentId: string;
  readonly reference: string;
  readonly amount: Money;
  readonly input: CreatePaymentInput;
  status: ProviderPaymentStatus;
  /** An unknown raw status word (`status` is then reported as `null`), for the "status the plugin does not know" case. */
  rawStatusOverride: string | null;
  failureCode: string | null;
  card: { system: string; last4: string } | null;
  modifiedAt: Date;
  readonly refunds: TestRefund[];
  /** Fields a spec forces into every fact of this invoice (a wrong amount, another reference). */
  override: Partial<ProviderPaymentFact>;
}

interface Planned {
  readonly operation: TestPaymentOperation | undefined;
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

const FROM_RAW: Readonly<Record<string, ProviderPaymentStatus>> = Object.fromEntries(
  Object.entries(RAW).map(([status, raw]) => [raw, status as ProviderPaymentStatus]),
);

const RAW_REFUND: Record<ProviderRefundStatus, string> = {
  processing: "processing",
  succeeded: "success",
  failed: "failure",
};

const FROM_RAW_REFUND: Readonly<Record<string, ProviderRefundStatus>> = Object.fromEntries(
  Object.entries(RAW_REFUND).map(([status, raw]) => [raw, status as ProviderRefundStatus]),
);

/** The webhook body: the status answer as the provider would send it (no card number, only system and last 4). */
interface WebhookBody {
  invoiceId: string;
  reference: string;
  status: string;
  amount: number;
  ccy: string;
  finalAmount: number | null;
  modifiedDate: string;
  errCode: string | null;
  cancelList: { extRef: string | null; status: string; amount: number; modifiedDate: string }[];
  paymentInfo: { paymentSystem: string; last4: string } | null;
}

export function signTestWebhook(rawBody: Uint8Array): string {
  return createHmac("sha256", TEST_PAYMENT_WEBHOOK_KEY).update(rawBody).digest("hex");
}

/** A webhook request with exactly these body bytes, correctly signed. */
export function signedTestWebhook(body: string | Uint8Array): PaymentWebhookInput {
  const rawBody = typeof body === "string" ? new TextEncoder().encode(body) : Uint8Array.from(body);
  return {
    headers: {
      "content-type": "application/json",
      [TEST_PAYMENT_SIGNATURE_HEADER]: signTestWebhook(rawBody),
    },
    rawBody,
  };
}

function signatureMatches(headers: Readonly<Record<string, string>>, rawBody: Uint8Array): boolean {
  const given = headers[TEST_PAYMENT_SIGNATURE_HEADER];
  if (typeof given !== "string" || !/^[0-9a-f]{64}$/.test(given)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(signTestWebhook(rawBody), "hex"));
}

function bodyOf(fact: ProviderPaymentFact): WebhookBody {
  return {
    invoiceId: fact.providerPaymentId,
    reference: fact.reference,
    status: fact.providerStatus,
    amount: fact.amount.amount,
    ccy: fact.amount.currency,
    finalAmount: fact.finalAmount === null ? null : fact.finalAmount.amount,
    modifiedDate: fact.modifiedAt.toISOString(),
    errCode: fact.failureCode,
    cancelList: fact.refunds.map((refund) => ({
      extRef: refund.refundId,
      status: RAW_REFUND[refund.status],
      amount: refund.amount.amount,
      modifiedDate: refund.modifiedAt.toISOString(),
    })),
    paymentInfo:
      fact.card === null ? null : { paymentSystem: fact.card.system, last4: fact.card.last4 },
  };
}

function factOfBody(body: WebhookBody): ProviderPaymentFact {
  const currency = body.ccy as Money["currency"];
  return {
    providerPaymentId: body.invoiceId,
    reference: body.reference,
    status: FROM_RAW[body.status] ?? null,
    providerStatus: body.status,
    amount: { amount: body.amount, currency },
    finalAmount: body.finalAmount === null ? null : { amount: body.finalAmount, currency },
    modifiedAt: new Date(body.modifiedDate),
    failureCode: body.errCode,
    refunds: body.cancelList.map((entry) => ({
      refundId: entry.extRef,
      status: FROM_RAW_REFUND[entry.status] ?? "failed",
      amount: { amount: entry.amount, currency },
      modifiedAt: new Date(entry.modifiedDate),
    })),
    card:
      body.paymentInfo === null
        ? null
        : { system: body.paymentInfo.paymentSystem, last4: body.paymentInfo.last4 },
  };
}

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
  /** Calls per operation that reached the provider (an aborted signal does not count). */
  readonly calls: Record<TestPaymentOperation, number> = {
    createPayment: 0,
    getPayment: 0,
    invalidatePayment: 0,
    refund: 0,
    verifyWebhook: 0,
  };
  /** New refunds are reported with this status (`processing` keeps them pending until `settleRefund`). */
  refundMode: ProviderRefundStatus = "succeeded";
  private planned: Planned[] = [];
  private readonly gates = new Map<TestPaymentOperation, Promise<void>>();
  private tick = 0;
  /** Part of every invoice id, new per instance and per `reset`: the database keeps invoice ids unique across specs. */
  private runId = randomBytes(4).toString("hex");

  failNext(failure: TestPaymentFailure = {}): void {
    this.planned.push({
      operation: failure.operation,
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
    });
  }

  /** Every call of `operation` waits until the returned function is called (a concurrency spec decides the order). */
  hold(operation: TestPaymentOperation): () => void {
    let release: () => void = () => undefined;
    this.gates.set(
      operation,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    return () => {
      this.gates.delete(operation);
      release();
    };
  }

  reset(): void {
    this.invoices.length = 0;
    this.creates.length = 0;
    this.refundCalls.length = 0;
    for (const operation of OPERATIONS) {
      this.calls[operation] = 0;
    }
    this.planned = [];
    this.gates.clear();
    this.refundMode = "succeeded";
    this.tick = 0;
    this.runId = randomBytes(4).toString("hex");
  }

  invoice(providerPaymentId: string): TestInvoice {
    const invoice = this.invoices.find((entry) => entry.providerPaymentId === providerPaymentId);
    if (invoice === undefined) {
      throw new RangeError("unknown test invoice");
    }
    return invoice;
  }

  /** The newest invoice created for our attempt id (`reference`). */
  invoiceOf(reference: string): TestInvoice {
    const invoice = this.invoices.filter((entry) => entry.reference === reference).at(-1);
    if (invoice === undefined) {
      throw new RangeError("no test invoice for this attempt");
    }
    return invoice;
  }

  /** Any status (and an optional failure code or card): the provider says the payment changed; `modifiedAt` moves on. */
  setStatus(
    providerPaymentId: string,
    status: ProviderPaymentStatus,
    extra: { failureCode?: string | null; card?: { system: string; last4: string } | null } = {},
  ): void {
    const invoice = this.invoice(providerPaymentId);
    invoice.status = status;
    if (extra.failureCode !== undefined) {
      invoice.failureCode = extra.failureCode;
    }
    invoice.card =
      extra.card !== undefined
        ? extra.card
        : status === "succeeded"
          ? { system: "visa", last4: "4242" }
          : invoice.card;
    invoice.modifiedAt = this.now();
  }

  /** A raw status word the plugin does not know (reported with `status: null`). */
  setUnknownStatus(providerPaymentId: string, raw: string): void {
    const invoice = this.invoice(providerPaymentId);
    invoice.rawStatusOverride = raw;
    invoice.modifiedAt = this.now();
  }

  /** Forces fields into every later fact of the invoice (a provider that disagrees with our data). */
  override(providerPaymentId: string, fields: Partial<ProviderPaymentFact>): void {
    this.invoice(providerPaymentId).override = { ...fields };
  }

  /** A refund made outside the shop (the merchant cabinet): no refund id of ours. */
  addExternalRefund(providerPaymentId: string, amount: Money): void {
    const invoice = this.invoice(providerPaymentId);
    const at = this.now();
    invoice.refunds.push({ refundId: null, amount, status: "succeeded", modifiedAt: at });
    invoice.modifiedAt = at;
  }

  settleRefund(providerPaymentId: string, refundId: string, status: ProviderRefundStatus): void {
    const invoice = this.invoice(providerPaymentId);
    const refund = invoice.refunds.find((entry) => entry.refundId === refundId);
    if (refund === undefined) {
      throw new RangeError("unknown test refund");
    }
    const at = this.now();
    refund.status = status;
    refund.modifiedAt = at;
    invoice.modifiedAt = at;
  }

  /** The fact a status read would answer now. */
  factOf(providerPaymentId: string): ProviderPaymentFact {
    return this.fact(this.invoice(providerPaymentId));
  }

  /** The body bytes of a webhook about the invoice's current state (exactly what the provider would send). */
  webhookBody(providerPaymentId: string): string {
    // Indented like a provider may send it, so a parser that re-serializes the body changes the bytes.
    return JSON.stringify(bodyOf(this.factOf(providerPaymentId)), null, 1);
  }

  /** A correctly signed webhook about the invoice's current state. */
  webhookFor(providerPaymentId: string): PaymentWebhookInput {
    return signedTestWebhook(this.webhookBody(providerPaymentId));
  }

  createPayment(
    input: CreatePaymentInput,
    signal: ProviderAbortSignal,
  ): Promise<PaymentProviderResult<PaymentCreated>> {
    if (signal.aborted) {
      return Promise.resolve(paymentProviderFailure("not_sent"));
    }
    this.creates.push(input);
    return this.run("createPayment", signal, () => {
      const providerPaymentId = `test-pay-${this.runId}-${String(this.invoices.length + 1).padStart(6, "0")}`;
      this.invoices.push({
        providerPaymentId,
        reference: input.paymentId,
        amount: input.amount,
        input,
        status: "created",
        rawStatusOverride: null,
        failureCode: null,
        card: null,
        modifiedAt: this.now(),
        refunds: [],
        override: {},
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
    return this.run("getPayment", signal, () => {
      const invoice = this.invoices.find((entry) => entry.providerPaymentId === providerPaymentId);
      return invoice === undefined
        ? paymentProviderFailure("not_found")
        : paymentProviderOk(this.fact(invoice));
    });
  }

  invalidatePayment(
    providerPaymentId: string,
    signal: ProviderAbortSignal,
  ): Promise<PaymentProviderResult<{ invalidated: boolean }>> {
    if (signal.aborted) {
      return Promise.resolve(paymentProviderFailure("not_sent"));
    }
    return this.run<{ invalidated: boolean }>("invalidatePayment", signal, () => {
      const invoice = this.invoices.find((entry) => entry.providerPaymentId === providerPaymentId);
      if (invoice === undefined) {
        return paymentProviderFailure("not_found");
      }
      if (invoice.status === "succeeded") {
        return paymentProviderFailure("not_cancellable", { providerCodes: ["already_paid"] });
      }
      if (invoice.status === "processing") {
        return paymentProviderFailure("not_cancellable", { providerCodes: ["in_progress"] });
      }
      if (invoice.status !== "created") {
        return paymentProviderOk({ invalidated: false });
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
    return this.run("refund", signal, () => {
      const invoice = this.invoices.find(
        (entry) => entry.providerPaymentId === input.providerPaymentId,
      );
      if (invoice === undefined) {
        return paymentProviderFailure("not_found");
      }
      const known = invoice.refunds.find((entry) => entry.refundId === input.refundId);
      if (known !== undefined) {
        return known.amount.amount === input.amount.amount
          ? paymentProviderOk({ status: known.status })
          : paymentProviderFailure("rejected", { providerCodes: ["extref_reused"] });
      }
      if (invoice.status !== "succeeded") {
        return paymentProviderFailure("not_cancellable", { providerCodes: ["not_paid"] });
      }
      const refunded = invoice.refunds
        .filter((entry) => entry.status !== "failed")
        .reduce((sum, entry) => sum + entry.amount.amount, 0);
      if (refunded + input.amount.amount > invoice.amount.amount) {
        return paymentProviderFailure("not_cancellable", {
          providerCodes: ["refund_exceeds_remaining"],
        });
      }
      const at = this.now();
      invoice.refunds.push({
        refundId: input.refundId,
        amount: input.amount,
        status: this.refundMode,
        modifiedAt: at,
      });
      invoice.modifiedAt = at;
      return paymentProviderOk({ status: this.refundMode });
    });
  }

  verifyWebhook(
    input: PaymentWebhookInput,
    signal: ProviderAbortSignal,
  ): Promise<PaymentProviderResult<ProviderPaymentFact>> {
    if (signal.aborted) {
      return Promise.resolve(paymentProviderFailure("not_sent"));
    }
    return this.run("verifyWebhook", signal, () => {
      // The signature over the exact bytes first; nothing is parsed before it verifies.
      if (!signatureMatches(input.headers, input.rawBody)) {
        return paymentProviderFailure("invalid_signature");
      }
      try {
        const body = JSON.parse(new TextDecoder().decode(input.rawBody)) as WebhookBody;
        return paymentProviderOk(factOfBody(body));
      } catch {
        return paymentProviderFailure("rejected", { providerCodes: ["malformed_body"] });
      }
    });
  }

  private now(): Date {
    this.tick += 1;
    return new Date(Date.UTC(2026, 0, 1) + this.tick * 1000);
  }

  private fact(invoice: TestInvoice): ProviderPaymentFact {
    const succeeded = invoice.refunds
      .filter((entry) => entry.status === "succeeded")
      .reduce((sum, entry) => sum + entry.amount.amount, 0);
    const finalAmount =
      invoice.status === "succeeded" || invoice.status === "reversed"
        ? {
            amount: invoice.status === "reversed" ? 0 : invoice.amount.amount - succeeded,
            currency: invoice.amount.currency,
          }
        : null;
    return {
      providerPaymentId: invoice.providerPaymentId,
      reference: invoice.reference,
      status: invoice.rawStatusOverride === null ? invoice.status : null,
      providerStatus: invoice.rawStatusOverride ?? RAW[invoice.status],
      amount: invoice.amount,
      finalAmount,
      modifiedAt: invoice.modifiedAt,
      failureCode: invoice.failureCode,
      refunds: invoice.refunds.map((entry) => ({ ...entry })),
      card: invoice.card,
      ...invoice.override,
    };
  }

  private take(operation: TestPaymentOperation): Planned | undefined {
    const index = this.planned.findIndex((entry) =>
      entry.operation === undefined ? operation !== "verifyWebhook" : entry.operation === operation,
    );
    const planned = index < 0 ? undefined : this.planned[index];
    if (planned === undefined) {
      return undefined;
    }
    planned.remaining -= 1;
    if (planned.remaining <= 0) {
      this.planned.splice(index, 1);
    }
    return planned;
  }

  private async run<T>(
    operation: TestPaymentOperation,
    signal: ProviderAbortSignal,
    effect: () => PaymentProviderResult<T>,
  ): Promise<PaymentProviderResult<T>> {
    this.calls[operation] += 1;
    const gate = this.gates.get(operation);
    if (gate !== undefined) {
      await gate;
    }
    const planned = this.take(operation);
    if (planned?.hang === true) {
      if (planned.afterEffect) {
        effect();
      }
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }
    if (planned?.throws === true) {
      if (planned.afterEffect) {
        effect();
      }
      throw new Error("test provider failure carrying card 4242424242424242 and token tok_secret");
    }
    if (planned !== undefined && !planned.afterEffect) {
      return planned.failure;
    }
    const answer = effect();
    return planned === undefined ? answer : planned.failure;
  }
}

@Module({ providers: [TestPaymentProvider], exports: [TestPaymentProvider] })
class TestPaymentProviderModule {}

/** The in-repo test payment provider as a loaded module: `startApp({ extraPaymentProviders: testPaymentProviders() })`. */
export function testPaymentProviders(): LoadedPaymentProvider[] {
  return [{ code: TEST_PAYMENT_PROVIDER_CODE, module: TestPaymentProviderModule as Type<unknown> }];
}
