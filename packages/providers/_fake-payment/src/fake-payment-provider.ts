import { Injectable, SetMetadata } from "@nestjs/common";
import {
  CURRENCY_CODES,
  isSupportedCurrency,
  PAYMENT_LIMITS,
  PAYMENT_PROVIDER_FAILURE_REASONS,
  PAYMENT_PROVIDER_METADATA,
  PROVIDER_PAYMENT_ID_PATTERN,
  paymentProviderFailure,
  paymentProviderMetadata,
  paymentProviderOk,
  providerPaymentFactProblems,
  type CreatePaymentInput,
  type Money,
  type PaymentCreated,
  type PaymentProviderCapabilities,
  type PaymentProviderFailure,
  type PaymentProviderFailureReason,
  type PaymentProviderPort,
  type PaymentProviderResult,
  type PaymentWebhookInput,
  type ProviderAbortSignal,
  type ProviderPaymentFact,
  type ProviderPaymentStatus,
  type ProviderRefundFact,
  type ProviderRefundStatus,
  type RefundInput,
} from "@fluxkit/core";
import { fakeWebhookInput, fakeWebhookSignatureMatches } from "./webhook.js";

/*
 * TEST-ONLY. A deterministic, in-memory payment provider: no network, no randomness, no wall clock, charges nothing. It
 * implements the whole `PaymentProviderPort` so the payment module, the provider loader and the e2e suites have a
 * provider that is always available, and it is driven by the test: invoices only change state when the test says so
 * (`complete`, `fail`, `expire`, ...). It must never be enabled in a real shop: `loadEnv` refuses
 * `PAYMENT_PROVIDERS_ENABLED=fake` when `NODE_ENV` is production.
 *
 * It models the Monobank facts of ADR 0032 that the payment module relies on, not more:
 * - create is NOT idempotent (M5: no idempotency key, dedupe by `reference` unknown): two creates with the same payment
 *   id make two invoices, so a payment module that repeats a create is caught here;
 * - a refund IS deduplicated by our refund id (`extRef`, M13: assumed): the same id and amount replays the first answer,
 *   the same id with another amount is refused;
 * - a refund is listed by `getPayment` under its refund id, so a lost refund answer can be settled (decision 13);
 * - the greater `modifiedAt` is current (M10): every state change moves it forward by one second of a logical clock.
 */

export const FAKE_PAYMENT_PROVIDER_CODE = "fake";

/** Origin of the invoice page the fake answers. A reserved `.invalid` host: nothing resolves it. */
export const FAKE_PAYMENT_PAGE_ORIGIN = "https://pay.fake.invalid";

/** The logical clock starts here and moves one second per state change, so facts order without a wall clock. */
const CLOCK_START_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

export type FakePaymentOperation =
  "createPayment" | "getPayment" | "invalidatePayment" | "refund" | "verifyWebhook";

/** The calls that reach the fake service; a failure without `operation` hits the next one of these. */
const SERVICE_OPERATIONS: readonly FakePaymentOperation[] = Object.freeze([
  "createPayment",
  "getPayment",
  "invalidatePayment",
  "refund",
]);

/** The raw status words of the fake service (Monobank's, where Monobank has one). */
const RAW_STATUS: Readonly<Record<ProviderPaymentStatus, string>> = Object.freeze({
  created: "created",
  processing: "processing",
  authorized: "hold",
  succeeded: "success",
  failed: "failure",
  reversed: "reversed",
  expired: "expired",
});

const RAW_REFUND_STATUS: Readonly<Record<ProviderRefundStatus, string>> = Object.freeze({
  processing: "processing",
  succeeded: "success",
  failed: "failure",
});

export interface FakePaymentFailure {
  /** Which call fails. Default: the next call of `createPayment`, `getPayment`, `invalidatePayment` or `refund`. */
  readonly operation?: FakePaymentOperation;
  /** Default `unavailable`. Any `PaymentProviderFailureReason`. */
  readonly reason?: PaymentProviderFailureReason;
  /** Raw service codes of the failure (`PAYMENT_CODE_PATTERN`); default none. */
  readonly providerCodes?: readonly string[];
  /** The service's `retry-after` in seconds. */
  readonly retryAfterSeconds?: number;
  /** How many matching calls fail. Default 1. */
  readonly times?: number;
  /**
   * The effect HAPPENS (the invoice is created, the refund recorded, the invoice invalidated) but the answer is lost:
   * the call answers the failure instead. The "unknown outcome" case: a repeat must not double the effect. For a call
   * without an effect (`getPayment`, `verifyWebhook`) it is a plain failure.
   */
  readonly afterEffect?: boolean;
  /** The call never answers until its abort signal fires, then rejects with the signal's reason (reproduces a timeout). */
  readonly hang?: boolean;
  /** The call rejects with an error instead of answering a result (a plugin bug or a crashed client). */
  readonly throws?: boolean;
}

interface PlannedFailure {
  readonly operation: FakePaymentOperation | undefined;
  readonly failure: PaymentProviderFailure;
  readonly afterEffect: boolean;
  readonly hang: boolean;
  readonly throws: boolean;
  remaining: number;
}

/** One refund of an invoice, as the fake service holds it (`refundId` is `null` for one made outside, in the "cabinet"). */
export interface FakeRefundRecord {
  readonly refundId: string | null;
  readonly amount: Money;
  readonly status: ProviderRefundStatus;
  readonly modifiedAt: Date;
}

/** One invoice as the fake service holds it (a copy: changing it changes nothing). */
export interface FakeInvoice {
  readonly providerPaymentId: string;
  /** The reference we sent: the attempt id. */
  readonly reference: string;
  readonly orderNumber: string;
  readonly description: string;
  readonly amount: Money;
  readonly expiresAt: Date;
  readonly returnUrl: string;
  readonly webhookUrl: string;
  readonly redirectUrl: string;
  readonly status: ProviderPaymentStatus;
  readonly providerStatus: string;
  readonly finalAmount: Money | null;
  readonly failureCode: string | null;
  readonly card: { readonly system: string; readonly last4: string } | null;
  readonly modifiedAt: Date;
  readonly refunds: readonly FakeRefundRecord[];
}

/** What reached the fake service for one call that passed local validation (a replay or a failed call counts too). */
export interface FakePaymentRequest {
  readonly operation: FakePaymentOperation;
  readonly paymentId?: string;
  readonly providerPaymentId?: string;
  readonly refundId?: string;
}

export interface FakePaymentProviderOptions {
  /** Another time source for `modifiedAt` (default: the logical clock, one second per state change). */
  readonly clock?: () => Date;
  /**
   * A verified webhook also moves the fake's own invoice to the state the webhook announces (default off). It exists for a
   * second process: when the API runs in another process than the test, a signed webhook is the only message that reaches
   * the fake, and a refund later needs the invoice to be paid. Only a webhook that is signed, about an invoice the fake
   * holds, with the invoice's own reference and amount and a time not older than the invoice's, is adopted.
   */
  readonly adoptVerifiedWebhooks?: boolean;
}

interface MutableInvoice {
  providerPaymentId: string;
  reference: string;
  orderNumber: string;
  description: string;
  amount: Money;
  expiresAt: Date;
  returnUrl: string;
  webhookUrl: string;
  redirectUrl: string;
  status: ProviderPaymentStatus;
  finalAmount: Money | null;
  failureCode: string | null;
  card: { system: string; last4: string } | null;
  modifiedAt: Date;
  refunds: {
    refundId: string | null;
    amount: Money;
    status: ProviderRefundStatus;
    modifiedAt: Date;
  }[];
}

const DEFAULT_CARD = Object.freeze({ system: "visa", last4: "4242" });

function codePoints(text: string): number {
  return [...text].length;
}

function isPositiveMoney(value: unknown): value is Money {
  const money = value as { amount?: unknown; currency?: unknown } | null;
  return (
    typeof money === "object" &&
    money !== null &&
    Number.isSafeInteger(money.amount) &&
    (money.amount as number) > 0 &&
    typeof money.currency === "string"
  );
}

function sameMoney(left: Money, right: Money): boolean {
  return left.amount === right.amount && left.currency === right.currency;
}

function copyInvoice(invoice: MutableInvoice): FakeInvoice {
  return {
    providerPaymentId: invoice.providerPaymentId,
    reference: invoice.reference,
    orderNumber: invoice.orderNumber,
    description: invoice.description,
    amount: { ...invoice.amount },
    expiresAt: new Date(invoice.expiresAt),
    returnUrl: invoice.returnUrl,
    webhookUrl: invoice.webhookUrl,
    redirectUrl: invoice.redirectUrl,
    status: invoice.status,
    providerStatus: RAW_STATUS[invoice.status],
    finalAmount: invoice.finalAmount === null ? null : { ...invoice.finalAmount },
    failureCode: invoice.failureCode,
    card: invoice.card === null ? null : { ...invoice.card },
    modifiedAt: new Date(invoice.modifiedAt),
    refunds: invoice.refunds.map((refund) => ({
      refundId: refund.refundId,
      amount: { ...refund.amount },
      status: refund.status,
      modifiedAt: new Date(refund.modifiedAt),
    })),
  };
}

function factOf(invoice: MutableInvoice): ProviderPaymentFact {
  const refunds: ProviderRefundFact[] = invoice.refunds.map((refund) => ({
    refundId: refund.refundId,
    status: refund.status,
    amount: { ...refund.amount },
    modifiedAt: new Date(refund.modifiedAt),
  }));
  return {
    providerPaymentId: invoice.providerPaymentId,
    reference: invoice.reference,
    status: invoice.status,
    providerStatus: RAW_STATUS[invoice.status],
    amount: { ...invoice.amount },
    finalAmount: invoice.finalAmount === null ? null : { ...invoice.finalAmount },
    modifiedAt: new Date(invoice.modifiedAt),
    failureCode: invoice.failureCode,
    refunds,
    card: invoice.card === null ? null : { ...invoice.card },
  };
}

/** The webhook body of an invoice: what the fake service would POST. Parsed back by `parseWebhookBody`. */
function webhookBodyOf(invoice: MutableInvoice): string {
  return JSON.stringify({
    invoiceId: invoice.providerPaymentId,
    reference: invoice.reference,
    status: RAW_STATUS[invoice.status],
    amount: invoice.amount.amount,
    currency: invoice.amount.currency,
    finalAmount: invoice.finalAmount === null ? null : invoice.finalAmount.amount,
    modifiedDate: invoice.modifiedAt.toISOString(),
    failureCode: invoice.failureCode,
    cancelList: invoice.refunds.map((refund) => ({
      extRef: refund.refundId,
      status: RAW_REFUND_STATUS[refund.status],
      amount: refund.amount.amount,
      modifiedDate: refund.modifiedAt.toISOString(),
    })),
    card: invoice.card,
  });
}

function statusOfRaw(raw: string): ProviderPaymentStatus | null {
  const found = (Object.entries(RAW_STATUS) as [ProviderPaymentStatus, string][]).find(
    ([, word]) => word === raw,
  );
  return found === undefined ? null : found[0];
}

function refundStatusOfRaw(raw: unknown): ProviderRefundStatus | undefined {
  const found = (Object.entries(RAW_REFUND_STATUS) as [ProviderRefundStatus, string][]).find(
    ([, word]) => word === raw,
  );
  return found === undefined ? undefined : found[0];
}

/** The fact in a signed webhook body, or `undefined` for a body that is not the fake's shape (or breaks the port). */
function parseWebhookBody(rawBody: Uint8Array): ProviderPaymentFact | undefined {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const currency = body.currency;
  if (
    typeof body.invoiceId !== "string" ||
    typeof body.reference !== "string" ||
    typeof body.status !== "string" ||
    typeof body.modifiedDate !== "string" ||
    !isSupportedCurrency(currency) ||
    !Array.isArray(body.cancelList)
  ) {
    return undefined;
  }
  const refunds: ProviderRefundFact[] = [];
  for (const entry of body.cancelList as unknown[]) {
    const item = (typeof entry === "object" && entry !== null ? entry : {}) as Record<
      string,
      unknown
    >;
    const status = refundStatusOfRaw(item.status);
    if (
      status === undefined ||
      typeof item.amount !== "number" ||
      typeof item.modifiedDate !== "string" ||
      (item.extRef !== null && typeof item.extRef !== "string")
    ) {
      return undefined;
    }
    refunds.push({
      refundId: item.extRef,
      status,
      amount: { amount: item.amount, currency },
      modifiedAt: new Date(item.modifiedDate),
    });
  }
  if (
    typeof body.amount !== "number" ||
    (body.finalAmount !== null && typeof body.finalAmount !== "number") ||
    (body.failureCode !== null && typeof body.failureCode !== "string")
  ) {
    return undefined;
  }
  const card = body.card as { system?: unknown; last4?: unknown } | null | undefined;
  const fact: ProviderPaymentFact = {
    providerPaymentId: body.invoiceId,
    reference: body.reference,
    status: statusOfRaw(body.status),
    providerStatus: body.status,
    amount: { amount: body.amount, currency },
    finalAmount: body.finalAmount === null ? null : { amount: body.finalAmount, currency },
    modifiedAt: new Date(body.modifiedDate),
    failureCode: body.failureCode,
    refunds,
    card:
      card === null || card === undefined
        ? null
        : { system: card.system as string, last4: card.last4 as string },
  };
  return providerPaymentFactProblems(fact).length === 0 ? fact : undefined;
}

@Injectable()
@SetMetadata(PAYMENT_PROVIDER_METADATA, paymentProviderMetadata(FAKE_PAYMENT_PROVIDER_CODE))
export class FakePaymentProvider implements PaymentProviderPort {
  readonly code = FAKE_PAYMENT_PROVIDER_CODE;
  readonly capabilities: PaymentProviderCapabilities = Object.freeze({
    // Every currency core knows, so the fake works with any `SHOP_CURRENCY` (the startup check compares this list).
    currencies: Object.freeze([...CURRENCY_CODES]),
    partialRefunds: true,
    multipleRefunds: true,
    invalidateUnpaid: true,
    webhooks: true,
  });

  private readonly invoiceById = new Map<string, MutableInvoice>();
  private readonly received: FakePaymentRequest[] = [];
  private planned: PlannedFailure | undefined;
  private refundMode: "succeeded" | "processing" = "succeeded";
  private tick = 0;

  constructor(private readonly options: FakePaymentProviderOptions = {}) {}

  /*
   * Test hooks. Not part of PaymentProviderPort; a test reaches them by `app.get(FakePaymentProvider)` or a cast of the
   * registry's answer. They act inside one process: a separate API process cannot be told to fail.
   */

  /** Makes the next `times` (default 1) matching calls fail as described. Replaces an earlier plan. A bad description throws now. */
  failNext(failure: FakePaymentFailure = {}): void {
    const times = failure.times ?? 1;
    if (!Number.isInteger(times) || times < 1) {
      throw new RangeError("failNext: times must be a positive integer");
    }
    const reason = failure.reason ?? "unavailable";
    if (!PAYMENT_PROVIDER_FAILURE_REASONS.includes(reason)) {
      throw new RangeError(`Unknown payment failure reason: ${String(reason)}`);
    }
    if (
      failure.operation !== undefined &&
      ![...SERVICE_OPERATIONS, "verifyWebhook"].includes(failure.operation)
    ) {
      throw new RangeError(`Unknown payment operation: ${String(failure.operation)}`);
    }
    this.planned = {
      operation: failure.operation,
      failure: paymentProviderFailure(reason, {
        providerCodes: failure.providerCodes,
        ...(failure.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: failure.retryAfterSeconds }),
      }),
      afterEffect: failure.afterEffect === true,
      hang: failure.hang === true,
      throws: failure.throws === true,
      remaining: times,
    };
  }

  /** New refunds are `processing` until `settleRefund` ("processing") or `succeeded` at once (default). */
  setRefundMode(mode: "succeeded" | "processing"): void {
    this.refundMode = mode;
  }

  /** The invoices, oldest first (copies). */
  invoices(): readonly FakeInvoice[] {
    return [...this.invoiceById.values()].map(copyInvoice);
  }

  /** One invoice (a copy), `undefined` for an unknown id. */
  invoice(providerPaymentId: string): FakeInvoice | undefined {
    const invoice = this.invoiceById.get(providerPaymentId);
    return invoice === undefined ? undefined : copyInvoice(invoice);
  }

  /** Every call that passed local validation, oldest first, replays and failed calls included. */
  requests(): readonly FakePaymentRequest[] {
    return [...this.received];
  }

  /** Forgets the invoices, the requests and any planned failure; numbering, the logical clock and the refund mode restart. */
  reset(): void {
    this.invoiceById.clear();
    this.received.length = 0;
    this.planned = undefined;
    this.refundMode = "succeeded";
    this.tick = 0;
  }

  /*
   * Status transitions, driven by the test. Each moves `modifiedAt` forward. A transition the real service would not
   * make from the current status is a bug in the test: RangeError.
   */

  /** `created` -> `processing`. */
  process(providerPaymentId: string): void {
    const invoice = this.require(providerPaymentId, ["created"], "process");
    invoice.status = "processing";
    this.touch(invoice);
  }

  /** `created` or `processing` -> `succeeded`; the final amount equals the amount and a card is recorded. */
  complete(providerPaymentId: string, card = DEFAULT_CARD): void {
    const invoice = this.require(providerPaymentId, ["created", "processing"], "complete");
    invoice.status = "succeeded";
    invoice.finalAmount = { ...invoice.amount };
    invoice.card = { system: card.system, last4: card.last4 };
    invoice.failureCode = null;
    this.touch(invoice);
  }

  /** `created` or `processing` -> `failed` with a provider error code (default `declined`). */
  fail(providerPaymentId: string, failureCode = "declined"): void {
    const invoice = this.require(providerPaymentId, ["created", "processing"], "fail");
    invoice.status = "failed";
    invoice.failureCode = failureCode;
    this.touch(invoice);
  }

  /** `created` or `processing` -> `expired`. The real service sends NO webhook for it (M8); `webhookFor` still builds one. */
  expire(providerPaymentId: string): void {
    const invoice = this.require(providerPaymentId, ["created", "processing"], "expire");
    invoice.status = "expired";
    this.touch(invoice);
  }

  /** `succeeded` -> `reversed`: a payment reversed outside the shop (a chargeback or a cabinet refund). */
  reverse(providerPaymentId: string): void {
    const invoice = this.require(providerPaymentId, ["succeeded"], "reverse");
    invoice.status = "reversed";
    this.touch(invoice);
  }

  /** A refund made outside the shop (the merchant cabinet): listed with `refundId` `null`, succeeded. */
  addExternalRefund(providerPaymentId: string, amount: Money): void {
    const invoice = this.require(providerPaymentId, ["succeeded"], "addExternalRefund");
    this.addRefund(invoice, null, amount, "succeeded");
  }

  /** Settles a `processing` refund of ours as `succeeded` or `failed`. */
  settleRefund(providerPaymentId: string, refundId: string, status: "succeeded" | "failed"): void {
    const invoice = this.require(providerPaymentId, ["succeeded"], "settleRefund");
    const refund = invoice.refunds.find((entry) => entry.refundId === refundId);
    if (refund?.status !== "processing") {
      throw new RangeError("settleRefund: the refund is unknown or not processing");
    }
    refund.status = status;
    this.touch(invoice);
    refund.modifiedAt = invoice.modifiedAt;
    this.recomputeFinalAmount(invoice);
  }

  /** The signed webhook the service would send for the invoice's current state (also for an expired one, see `expire`). */
  webhookFor(providerPaymentId: string): PaymentWebhookInput {
    const invoice = this.invoiceById.get(providerPaymentId);
    if (invoice === undefined) {
      throw new RangeError("webhookFor: unknown invoice");
    }
    return fakeWebhookInput(webhookBodyOf(invoice));
  }

  /*
   * The port.
   */

  createPayment(
    input: CreatePaymentInput,
    signal: ProviderAbortSignal,
  ): Promise<PaymentProviderResult<PaymentCreated>> {
    // Nothing leaves the process before these checks, so each is `not_sent` (always safe to retry).
    if (signal.aborted) {
      return Promise.resolve(paymentProviderFailure("not_sent", { providerCodes: ["aborted"] }));
    }
    if (
      !isPositiveMoney(input.amount) ||
      !this.capabilities.currencies.includes(input.amount.currency) ||
      typeof input.paymentId !== "string" ||
      input.paymentId === "" ||
      codePoints(input.description) > PAYMENT_LIMITS.descriptionMaxLength
    ) {
      return Promise.resolve(
        paymentProviderFailure("not_sent", { providerCodes: ["invalid_request"] }),
      );
    }
    this.received.push({ operation: "createPayment", paymentId: input.paymentId });
    return this.run<PaymentCreated>("createPayment", signal, () => {
      const providerPaymentId = `fake-pay-${String(this.invoiceById.size + 1).padStart(6, "0")}`;
      const redirectUrl = `${FAKE_PAYMENT_PAGE_ORIGIN}/pay/${providerPaymentId}`;
      this.invoiceById.set(providerPaymentId, {
        providerPaymentId,
        reference: input.paymentId,
        orderNumber: input.orderNumber,
        description: input.description,
        amount: { ...input.amount },
        expiresAt: new Date(input.expiresAt),
        returnUrl: input.returnUrl,
        webhookUrl: input.webhookUrl,
        redirectUrl,
        status: "created",
        finalAmount: null,
        failureCode: null,
        card: null,
        modifiedAt: this.now(),
        refunds: [],
      });
      return paymentProviderOk({ providerPaymentId, redirectUrl });
    });
  }

  getPayment(
    providerPaymentId: string,
    signal: ProviderAbortSignal,
  ): Promise<PaymentProviderResult<ProviderPaymentFact>> {
    const early = this.checkId(providerPaymentId, signal);
    if (early !== undefined) {
      return Promise.resolve(early);
    }
    this.received.push({ operation: "getPayment", providerPaymentId });
    return this.run<ProviderPaymentFact>("getPayment", signal, () => {
      const invoice = this.invoiceById.get(providerPaymentId);
      return invoice === undefined
        ? paymentProviderFailure("not_found", { providerCodes: ["unknown_payment"] })
        : paymentProviderOk(factOf(invoice));
    });
  }

  invalidatePayment(
    providerPaymentId: string,
    signal: ProviderAbortSignal,
  ): Promise<PaymentProviderResult<{ invalidated: boolean }>> {
    const early = this.checkId(providerPaymentId, signal);
    if (early !== undefined) {
      return Promise.resolve(early);
    }
    this.received.push({ operation: "invalidatePayment", providerPaymentId });
    return this.run<{ invalidated: boolean }>("invalidatePayment", signal, () => {
      const invoice = this.invoiceById.get(providerPaymentId);
      if (invoice === undefined) {
        return paymentProviderFailure("not_found", { providerCodes: ["unknown_payment"] });
      }
      switch (invoice.status) {
        case "created":
          invoice.status = "expired";
          this.touch(invoice);
          return paymentProviderOk({ invalidated: true });
        case "expired":
          return paymentProviderOk({ invalidated: true });
        case "failed":
        case "reversed":
          return paymentProviderOk({ invalidated: false });
        case "succeeded":
          return paymentProviderFailure("not_cancellable", { providerCodes: ["already_paid"] });
        default:
          return paymentProviderFailure("not_cancellable", { providerCodes: ["in_progress"] });
      }
    });
  }

  refund(
    input: RefundInput,
    signal: ProviderAbortSignal,
  ): Promise<PaymentProviderResult<{ status: ProviderRefundStatus }>> {
    const early = this.checkId(input.providerPaymentId, signal);
    if (early !== undefined) {
      return Promise.resolve(early);
    }
    if (
      !isPositiveMoney(input.amount) ||
      typeof input.refundId !== "string" ||
      input.refundId === ""
    ) {
      return Promise.resolve(
        paymentProviderFailure("not_sent", { providerCodes: ["invalid_request"] }),
      );
    }
    this.received.push({
      operation: "refund",
      providerPaymentId: input.providerPaymentId,
      refundId: input.refundId,
    });
    return this.run<{ status: ProviderRefundStatus }>("refund", signal, () => {
      const invoice = this.invoiceById.get(input.providerPaymentId);
      if (invoice === undefined) {
        return paymentProviderFailure("not_found", { providerCodes: ["unknown_payment"] });
      }
      // Deduplicated by our refund id (`extRef`): the same request replays its answer, a different amount is refused.
      const known = invoice.refunds.find((entry) => entry.refundId === input.refundId);
      if (known !== undefined) {
        return sameMoney(known.amount, input.amount)
          ? paymentProviderOk({ status: known.status })
          : paymentProviderFailure("rejected", { providerCodes: ["extref_reused"] });
      }
      if (invoice.status !== "succeeded") {
        return paymentProviderFailure("not_cancellable", { providerCodes: ["not_paid"] });
      }
      if (input.amount.currency !== invoice.amount.currency) {
        return paymentProviderFailure("rejected", { providerCodes: ["currency_mismatch"] });
      }
      const refunded = invoice.refunds
        .filter((entry) => entry.status !== "failed")
        .reduce((sum, entry) => sum + entry.amount.amount, 0);
      if (refunded + input.amount.amount > invoice.amount.amount || (input.full && refunded > 0)) {
        return paymentProviderFailure("not_cancellable", {
          providerCodes: ["refund_exceeds_remaining"],
        });
      }
      this.addRefund(invoice, input.refundId, input.amount, this.refundMode);
      return paymentProviderOk({ status: this.refundMode });
    });
  }

  verifyWebhook(
    input: PaymentWebhookInput,
    signal: ProviderAbortSignal,
  ): Promise<PaymentProviderResult<ProviderPaymentFact>> {
    if (signal.aborted) {
      return Promise.resolve(paymentProviderFailure("not_sent", { providerCodes: ["aborted"] }));
    }
    this.received.push({ operation: "verifyWebhook" });
    return this.run<ProviderPaymentFact>("verifyWebhook", signal, () => {
      if (input.rawBody.byteLength > PAYMENT_LIMITS.webhookBodyMaxBytes) {
        return paymentProviderFailure("rejected", { providerCodes: ["body_too_large"] });
      }
      // The signature is checked over the exact bytes first: nothing of the body is read before it verifies.
      if (!fakeWebhookSignatureMatches(input.headers, input.rawBody)) {
        return paymentProviderFailure("invalid_signature", { providerCodes: ["bad_signature"] });
      }
      const fact = parseWebhookBody(input.rawBody);
      if (fact === undefined) {
        return paymentProviderFailure("rejected", { providerCodes: ["malformed_body"] });
      }
      if (this.options.adoptVerifiedWebhooks === true) {
        this.adopt(fact);
      }
      return paymentProviderOk(fact);
    });
  }

  /*
   * Internals.
   */

  private now(): Date {
    if (this.options.clock !== undefined) {
      return this.options.clock();
    }
    this.tick += 1;
    return new Date(CLOCK_START_MS + this.tick * 1000);
  }

  /** See `adoptVerifiedWebhooks`: the service's own state follows what a verified webhook says it did. */
  private adopt(fact: ProviderPaymentFact): void {
    const invoice = this.invoiceById.get(fact.providerPaymentId);
    if (
      invoice === undefined ||
      fact.status === null ||
      invoice.reference !== fact.reference ||
      !sameMoney(invoice.amount, fact.amount) ||
      fact.modifiedAt.getTime() < invoice.modifiedAt.getTime()
    ) {
      return;
    }
    invoice.status = fact.status;
    invoice.finalAmount = fact.finalAmount === null ? null : { ...fact.finalAmount };
    invoice.failureCode = fact.failureCode;
    invoice.card = fact.card === null ? null : { ...fact.card };
    invoice.refunds = fact.refunds.map((refund) => ({
      refundId: refund.refundId,
      amount: { ...refund.amount },
      status: refund.status,
      modifiedAt: new Date(refund.modifiedAt),
    }));
    invoice.modifiedAt = new Date(fact.modifiedAt);
    // Later changes of the fake itself (a refund) must stay newer than what was adopted (M10: the greater time is current).
    const seconds = Math.ceil((fact.modifiedAt.getTime() - CLOCK_START_MS) / 1000);
    if (this.options.clock === undefined && seconds > this.tick) {
      this.tick = seconds;
    }
  }

  private touch(invoice: MutableInvoice): void {
    invoice.modifiedAt = this.now();
  }

  private require(
    providerPaymentId: string,
    allowed: readonly ProviderPaymentStatus[],
    action: string,
  ): MutableInvoice {
    const invoice = this.invoiceById.get(providerPaymentId);
    if (invoice === undefined) {
      throw new RangeError(`${action}: unknown invoice`);
    }
    if (!allowed.includes(invoice.status)) {
      throw new RangeError(`${action}: not possible from the status ${invoice.status}`);
    }
    return invoice;
  }

  private addRefund(
    invoice: MutableInvoice,
    refundId: string | null,
    amount: Money,
    status: ProviderRefundStatus,
  ): void {
    this.touch(invoice);
    invoice.refunds.push({
      refundId,
      amount: { ...amount },
      status,
      modifiedAt: invoice.modifiedAt,
    });
    this.recomputeFinalAmount(invoice);
  }

  /** The final amount is the amount less the succeeded refunds (core `bindFact` accepts exactly this). */
  private recomputeFinalAmount(invoice: MutableInvoice): void {
    const refunded = invoice.refunds
      .filter((entry) => entry.status === "succeeded")
      .reduce((sum, entry) => sum + entry.amount.amount, 0);
    invoice.finalAmount = {
      amount: Math.max(0, invoice.amount.amount - refunded),
      currency: invoice.amount.currency,
    };
  }

  private checkId(
    providerPaymentId: string,
    signal: ProviderAbortSignal,
  ): PaymentProviderFailure | undefined {
    if (signal.aborted) {
      return paymentProviderFailure("not_sent", { providerCodes: ["aborted"] });
    }
    if (
      typeof providerPaymentId !== "string" ||
      !PROVIDER_PAYMENT_ID_PATTERN.test(providerPaymentId)
    ) {
      return paymentProviderFailure("not_sent", { providerCodes: ["invalid_request"] });
    }
    return undefined;
  }

  private takePlanned(operation: FakePaymentOperation): PlannedFailure | undefined {
    const planned = this.planned;
    if (planned === undefined) {
      return undefined;
    }
    const matches =
      planned.operation === undefined
        ? SERVICE_OPERATIONS.includes(operation)
        : planned.operation === operation;
    if (!matches) {
      return undefined;
    }
    planned.remaining -= 1;
    if (planned.remaining <= 0) {
      this.planned = undefined;
    }
    return planned;
  }

  /** Applies a planned failure (hang, throw, plain, or after the effect), else runs the service. */
  private run<T>(
    operation: FakePaymentOperation,
    signal: ProviderAbortSignal,
    effect: () => PaymentProviderResult<T>,
  ): Promise<PaymentProviderResult<T>> {
    const planned = this.takePlanned(operation);
    if (planned?.hang === true) {
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }
    if (planned?.throws === true) {
      if (planned.afterEffect) {
        effect();
      }
      return Promise.reject(new Error("fake payment provider failure"));
    }
    if (planned !== undefined && !planned.afterEffect) {
      return Promise.resolve(planned.failure);
    }
    const answer = effect();
    return Promise.resolve(planned === undefined ? answer : planned.failure);
  }
}
