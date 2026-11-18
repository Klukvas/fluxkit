import { Inject, Injectable, SetMetadata } from "@nestjs/common";
import {
  PAYMENT_CODE_PATTERN,
  PAYMENT_LIMITS,
  PAYMENT_PROVIDER_METADATA,
  PROVIDER_PAYMENT_ID_PATTERN,
  paymentProviderFailure,
  paymentProviderMetadata,
  paymentProviderOk,
  type CreatePaymentInput,
  type PaymentCheckoutHandoff,
  type PaymentCreated,
  type PaymentProviderCapabilities,
  type PaymentProviderFailure,
  type PaymentProviderPort,
  type PaymentProviderResult,
  type PaymentWebhookInput,
  type ProviderAbortSignal,
  type ProviderPaymentFact,
  type ProviderRefundStatus,
  type RefundInput,
} from "@fluxkit/core";
import { failureOfExchange, malformedAnswer, mapLiqPayError } from "./answer-map.js";
import { LIQPAY_API_ORIGIN, LIQPAY_CURRENCY, LIQPAY_PATHS, LIQPAY_VERSION } from "./config.js";
import { LiqPayHttp, type LiqPayAnswer, type LiqPayExchange } from "./http.js";
import {
  checkoutParamsOf,
  factOf,
  handoffFieldsOf,
  majorAmountOf,
  parseWebhookForm,
  readRefundStatus,
  type CreateRefusal,
  validateCreateInput,
} from "./payload.js";
import { signatureOf, signatureValid } from "./signature.js";

export const LIQPAY_PROVIDER_CODE = "liqpay";

export const LIQPAY_HTTP = Symbol("LIQPAY_HTTP");
export const LIQPAY_LOGGER = Symbol("LIQPAY_LOGGER");
export const LIQPAY_CLOCK = Symbol("LIQPAY_CLOCK");

export interface LiqPayLogger {
  warn(message: string): void;
  error(message: string): void;
}

export type LiqPayClock = () => Date;

export const LIQPAY_CAPABILITIES: PaymentProviderCapabilities = Object.freeze({
  currencies: Object.freeze([LIQPAY_CURRENCY]),
  partialRefunds: true,
  multipleRefunds: false,
  invalidateUnpaid: false,
  webhooks: true,
  formHandoff: true,
});

type Operation =
  | "createPayment"
  | "getPayment"
  | "invalidatePayment"
  | "refund"
  | "verifyWebhook"
  | "buildCheckoutHandoff";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
@SetMetadata(PAYMENT_PROVIDER_METADATA, paymentProviderMetadata(LIQPAY_PROVIDER_CODE))
export class LiqPayPaymentProvider implements PaymentProviderPort {
  readonly code = LIQPAY_PROVIDER_CODE;
  readonly capabilities = LIQPAY_CAPABILITIES;
  private keysMisconfiguredLogged = false;

  constructor(
    @Inject(LIQPAY_HTTP) private readonly http: LiqPayHttp,
    @Inject(LIQPAY_LOGGER) private readonly logger: LiqPayLogger,
    @Inject(LIQPAY_CLOCK) private readonly clock: LiqPayClock,
  ) {}

  async createPayment(
    input: CreatePaymentInput,
    signal: ProviderAbortSignal,
  ): Promise<PaymentProviderResult<PaymentCreated>> {
    if (signal.aborted) {
      return this.local("createPayment", "aborted");
    }
    const refusal = validateCreateInput(input, this.clock());
    if (refusal !== undefined) {
      return this.local("createPayment", refusal);
    }
    if (input.handoffUrl === undefined) {
      return this.local("createPayment", "missing_handoff_url");
    }
    return paymentProviderOk({
      providerPaymentId: input.paymentId,
      redirectUrl: input.handoffUrl,
    });
  }

  async buildCheckoutHandoff(
    input: CreatePaymentInput,
    signal: ProviderAbortSignal,
  ): Promise<PaymentProviderResult<PaymentCheckoutHandoff>> {
    if (signal.aborted) {
      return this.local("buildCheckoutHandoff", "aborted");
    }
    const params = checkoutParamsOf(input, this.http.publicKey, this.clock());
    if (typeof params === "string") {
      return this.local("buildCheckoutHandoff", params as CreateRefusal);
    }
    const fields = handoffFieldsOf(params, this.http.privateKey);
    return paymentProviderOk({
      actionUrl: `${LIQPAY_API_ORIGIN}${LIQPAY_PATHS.checkout}`,
      fields: Object.freeze(fields),
    });
  }

  async getPayment(
    providerPaymentId: string,
    signal: ProviderAbortSignal,
  ): Promise<PaymentProviderResult<ProviderPaymentFact>> {
    if (
      typeof providerPaymentId !== "string" ||
      !PROVIDER_PAYMENT_ID_PATTERN.test(providerPaymentId)
    ) {
      return this.local("getPayment", "invalid_provider_payment_id");
    }
    return this.exchange(
      "getPayment",
      {
        path: LIQPAY_PATHS.request,
        params: { action: "status", version: LIQPAY_VERSION, order_id: providerPaymentId },
      },
      signal,
      (answer) => {
        const read = factOf(answer.json, providerPaymentId);
        return read.ok ? paymentProviderOk(read.fact) : malformedAnswer(answer.status, read.detail);
      },
    );
  }

  async invalidatePayment(
    providerPaymentId: string,
    signal: ProviderAbortSignal,
  ): Promise<PaymentProviderResult<{ invalidated: boolean }>> {
    if (signal.aborted) {
      return this.local("invalidatePayment", "aborted");
    }
    if (
      typeof providerPaymentId !== "string" ||
      !PROVIDER_PAYMENT_ID_PATTERN.test(providerPaymentId)
    ) {
      return this.local("invalidatePayment", "invalid_provider_payment_id");
    }
    return paymentProviderOk({ invalidated: false });
  }

  async refund(
    input: RefundInput,
    signal: ProviderAbortSignal,
  ): Promise<PaymentProviderResult<{ status: ProviderRefundStatus }>> {
    if (
      typeof input.providerPaymentId !== "string" ||
      !PROVIDER_PAYMENT_ID_PATTERN.test(input.providerPaymentId)
    ) {
      return this.local("refund", "invalid_provider_payment_id");
    }
    if (!UUID.test(input.refundId) || !PAYMENT_CODE_PATTERN.test(input.refundId)) {
      return this.local("refund", "invalid_refund_id");
    }
    if (input.amount.currency !== LIQPAY_CURRENCY) {
      return this.local("refund", "currency_not_supported");
    }
    if (!Number.isSafeInteger(input.amount.amount) || input.amount.amount < 1) {
      return this.local("refund", "invalid_amount");
    }
    const major = majorAmountOf(input.amount);
    if (!Number.isFinite(major) || major <= 0) {
      return this.local("refund", "invalid_amount");
    }
    return this.exchange(
      "refund",
      {
        path: LIQPAY_PATHS.request,
        params: {
          action: "refund",
          version: LIQPAY_VERSION,
          order_id: input.providerPaymentId,
          amount: major,
          refund_ref: input.refundId,
        },
      },
      signal,
      (answer) => {
        const status = readRefundStatus(answer.json);
        return status === undefined
          ? malformedAnswer(answer.status)
          : paymentProviderOk({ status });
      },
    );
  }

  async verifyWebhook(
    input: PaymentWebhookInput,
    signal: ProviderAbortSignal,
  ): Promise<PaymentProviderResult<ProviderPaymentFact>> {
    if (signal.aborted) {
      return this.local("verifyWebhook", "aborted");
    }
    const body = input.rawBody;
    if (!(body instanceof Uint8Array) || body.byteLength === 0) {
      return this.invalid("empty_body");
    }
    if (body.byteLength > PAYMENT_LIMITS.webhookBodyMaxBytes) {
      return this.invalid("body_too_large");
    }
    const contentType = input.headers["content-type"] ?? input.headers["Content-Type"];
    if (
      contentType === undefined ||
      !contentType.toLowerCase().includes("application/x-www-form-urlencoded")
    ) {
      return this.invalid("malformed_signature");
    }
    let form: { data?: string; signature?: string };
    try {
      form = parseWebhookForm(body);
    } catch {
      return this.invalid("malformed_body");
    }
    const data = form.data;
    const signature = signatureOf(form.signature);
    if (data === undefined || data === "" || signature === undefined) {
      return this.invalid("malformed_signature");
    }
    if (!signatureValid(data, signature, this.http.privateKey)) {
      return this.invalid("signature_mismatch");
    }
    let json: unknown;
    try {
      json = JSON.parse(Buffer.from(data, "base64").toString("utf8")) as unknown;
    } catch {
      json = undefined;
    }
    const read = factOf(json);
    if (!read.ok) {
      const failure = paymentProviderFailure("unavailable", {
        providerCodes: [read.detail, "webhook"],
      });
      this.logFailure("verifyWebhook", "verified body", failure, 0);
      return failure;
    }
    return paymentProviderOk(read.fact);
  }

  private invalid(code: string): PaymentProviderFailure {
    const failure = paymentProviderFailure("invalid_signature", { providerCodes: [code] });
    this.logger.warn(`verifyWebhook: invalid_signature (${code})`);
    return failure;
  }

  private local(operation: Operation, code: string): PaymentProviderFailure {
    const failure = paymentProviderFailure("not_sent", { providerCodes: [code] });
    this.logger.warn(`${operation}: not sent -> not_sent (${code})`);
    return failure;
  }

  private async exchange<T>(
    operation: Operation,
    request: Parameters<LiqPayHttp["call"]>[0],
    signal: ProviderAbortSignal,
    read: (answer: LiqPayAnswer) => T | PaymentProviderFailure,
  ): Promise<T | PaymentProviderFailure> {
    const started = performance.now();
    const exchange: LiqPayExchange = await this.http.call(request, signal);
    const elapsed = Math.round(performance.now() - started);
    if (exchange.kind === "failed") {
      const failure = failureOfExchange(exchange);
      this.logFailure(operation, "no answer", failure, elapsed);
      return failure;
    }
    const { answer } = exchange;
    const result =
      answer.status >= 200 && answer.status < 300 ? read(answer) : mapLiqPayError(answer);
    if (typeof result === "object" && result !== null && "ok" in result && result.ok === false) {
      this.logFailure(
        operation,
        `HTTP ${String(answer.status)}`,
        result as PaymentProviderFailure,
        elapsed,
      );
    }
    return result;
  }

  private logFailure(
    operation: Operation,
    what: string,
    failure: PaymentProviderFailure,
    elapsedMs: number,
  ): void {
    const line = `${operation}: ${what} -> ${failure.reason} (${failure.providerCodes.join(",")}) after ${String(elapsedMs)} ms`;
    if (
      failure.reason === "misconfigured" &&
      failure.providerCodes.some((c) => c === "403" || c === "401")
    ) {
      if (!this.keysMisconfiguredLogged) {
        this.keysMisconfiguredLogged = true;
        this.logger.error(
          `${line}; LiqPay refused the keys: check LIQPAY_PUBLIC_KEY and LIQPAY_PRIVATE_KEY (logged once per process)`,
        );
        return;
      }
    }
    this.logger.warn(line);
  }
}
