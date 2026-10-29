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
import { failureOfExchange, malformedAnswer, mapMonobankError } from "./answer-map.js";
import { MONOBANK_PATHS } from "./config.js";
import {
  MonobankHttp,
  type MonobankAnswer,
  type MonobankExchange,
  type MonobankRequest,
} from "./http.js";
import {
  createBodyOf,
  factOf,
  MONOBANK_CURRENCY,
  readCancelAnswer,
  readCreateAnswer,
} from "./invoice.js";
import {
  MONOBANK_SIGNATURE_HEADER,
  MonobankKeyCache,
  publicKeyOf,
  signatureOf,
  type KeyLoad,
} from "./signature.js";

/*
 * The Monobank acquiring payment provider (code `monobank`; ADR 0032 decisions 3, 14 and 15; payments plan step 7). Each
 * operation makes at most ONE request to Monobank (plus, for a webhook, the rare key fetch of `MonobankKeyCache`) and
 * never repeats it: retries are the API's decision, and a create or a refund whose answer was lost is never resent
 * (M5: no create idempotency; M13: whether `extRef` deduplicates a refund is UNKNOWN).
 * - `not_sent` only when nothing left the process: an input refused before any request, a signal that had fired before
 *   the request (`MonobankHttp` checks it right before `fetch`).
 * - Every other failure is mapped from Monobank's answer by status and documented `errCode` only (`mapMonobankError`),
 *   or from the transport (`unavailable`: a timeout or a network failure may have reached Monobank). An unreadable 2xx
 *   is `unavailable`, never a refusal: the invoice or the refund may exist.
 * - Logs: the outcome as operation, status, reason, codes and duration; never the token, a body, `errText`, a card mask or
 *   a URL. A `403` (invalid token) is logged once per process as an error, other failures as warnings; nothing on success.
 */

export const MONOBANK_PROVIDER_CODE = "monobank";

/** Nest token of the `MonobankHttp` instance (the module's factory builds it from `MONOBANK_TOKEN`). */
export const MONOBANK_HTTP = Symbol("MONOBANK_HTTP");
/** Nest token of the logger. */
export const MONOBANK_LOGGER = Symbol("MONOBANK_LOGGER");
/** Nest token of the clock (`() => Date`): the invoice `validity` and the key refetch interval read it. */
export const MONOBANK_CLOCK = Symbol("MONOBANK_CLOCK");

export interface MonobankLogger {
  warn(message: string): void;
  error(message: string): void;
}

export type MonobankClock = () => Date;

/** The provider's capabilities (ADR 0032 decision 3; registry checks them, and `SHOP_CURRENCY` must be UAH). */
export const MONOBANK_CAPABILITIES: PaymentProviderCapabilities = Object.freeze({
  /** UAH only (question 6; M18 UNKNOWN for other currencies). */
  currencies: Object.freeze([MONOBANK_CURRENCY]),
  /** `invoice/cancel` takes an `amount` "for a partial refund" (M13). */
  partialRefunds: true,
  /** `cancelList[]` lists several refunds per invoice (M6); several partial refunds are LIKELY, UNKNOWN in detail (M13). */
  multipleRefunds: true,
  /** `invoice/remove` invalidates an unpaid invoice (M14). */
  invalidateUnpaid: true,
  /** Webhooks on every status change but `expired` (M8). */
  webhooks: true,
});

type Operation = "createPayment" | "getPayment" | "invalidatePayment" | "refund" | "verifyWebhook";

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

@Injectable()
@SetMetadata(PAYMENT_PROVIDER_METADATA, paymentProviderMetadata(MONOBANK_PROVIDER_CODE))
export class MonobankPaymentProvider implements PaymentProviderPort {
  readonly code = MONOBANK_PROVIDER_CODE;
  readonly capabilities = MONOBANK_CAPABILITIES;
  private readonly keys: MonobankKeyCache;
  private tokenRefusalLogged = false;

  constructor(
    @Inject(MONOBANK_HTTP) private readonly http: MonobankHttp,
    @Inject(MONOBANK_LOGGER) private readonly logger: MonobankLogger,
    @Inject(MONOBANK_CLOCK) private readonly clock: MonobankClock,
  ) {
    this.keys = new MonobankKeyCache(() => this.clock().getTime());
  }

  async createPayment(
    input: CreatePaymentInput,
    signal: ProviderAbortSignal,
  ): Promise<PaymentProviderResult<PaymentCreated>> {
    const built = createBodyOf(input, this.clock());
    if (!built.ok) {
      return this.local("createPayment", built.refusal);
    }
    return this.exchange(
      "createPayment",
      { method: "POST", path: MONOBANK_PATHS.create, body: JSON.stringify(built.body) },
      signal,
      (answer) => {
        const read = readCreateAnswer(answer.json);
        return read.ok
          ? paymentProviderOk({ providerPaymentId: read.invoiceId, redirectUrl: read.pageUrl })
          : malformedAnswer(answer.status, read.detail);
      },
    );
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
      { method: "GET", path: MONOBANK_PATHS.status, invoiceId: providerPaymentId },
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
    if (
      typeof providerPaymentId !== "string" ||
      !PROVIDER_PAYMENT_ID_PATTERN.test(providerPaymentId)
    ) {
      return this.local("invalidatePayment", "invalid_provider_payment_id");
    }
    // M14: "200, an empty answer". Any 2xx is taken as done (its body is not read).
    return this.exchange(
      "invalidatePayment",
      {
        method: "POST",
        path: MONOBANK_PATHS.remove,
        body: JSON.stringify({ invoiceId: providerPaymentId }),
      },
      signal,
      () => paymentProviderOk({ invalidated: true }),
    );
  }

  /**
   * `POST /api/merchant/invoice/cancel` with `extRef` = our refund id and the `amount` always sent, also for a full
   * refund (it pins exactly what core accounted; the spec documents `amount` "for a partial refund" and omitting it
   * cancels the whole payment: UNVERIFIED that an explicit full amount is accepted, S1). Never resent after a lost
   * answer: whether Monobank deduplicates `extRef` is UNKNOWN (M13); core settles a lost answer from `getPayment`'s
   * refunds by our refund id.
   */
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
    if (!isUuid(input.refundId) || !PAYMENT_CODE_PATTERN.test(input.refundId)) {
      return this.local("refund", "invalid_refund_id");
    }
    if (input.amount.currency !== MONOBANK_CURRENCY) {
      return this.local("refund", "currency_not_supported");
    }
    if (!Number.isSafeInteger(input.amount.amount) || input.amount.amount < 1) {
      return this.local("refund", "invalid_amount");
    }
    return this.exchange(
      "refund",
      {
        method: "POST",
        path: MONOBANK_PATHS.cancel,
        body: JSON.stringify({
          invoiceId: input.providerPaymentId,
          extRef: input.refundId,
          amount: input.amount.amount,
        }),
      },
      signal,
      (answer) => {
        const status = readCancelAnswer(answer.json);
        return status === undefined
          ? malformedAnswer(answer.status)
          : paymentProviderOk({ status });
      },
    );
  }

  /**
   * Verifies `X-Sign` over the exact raw bytes FIRST (M12); only a body whose signature verifies is parsed and returned
   * as a fact. No header but `x-sign` is read, and nothing in the request can choose the key. A missing, empty or
   * malformed signature, an empty or oversized body and a signature that does not verify (after the throttled refetch)
   * are `invalid_signature`; a key that cannot be fetched is `unavailable` (the API answers so that Monobank retries).
   */
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
    const signature = signatureOf(input.headers[MONOBANK_SIGNATURE_HEADER]);
    if (signature === undefined) {
      return this.invalid("malformed_signature");
    }
    const verification = await this.keys.verify(body, signature, () => this.fetchKey(signal));
    if (verification.kind === "unavailable") {
      // A failed fetch was logged by `exchange`; a fetch skipped by the throttle is logged here.
      if (verification.failure.providerCodes.includes("key_unavailable")) {
        this.logFailure("verifyWebhook", "key fetch throttled", verification.failure, 0);
      }
      return verification.failure;
    }
    if (verification.kind === "invalid") {
      return this.invalid("signature_mismatch");
    }
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
    } catch {
      // A verified body that is not JSON: Monobank sent something the plugin cannot read.
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

  // -------------------------------------------------------------------------------------------------------------------

  /** `GET /api/merchant/pubkey` with the token; the key must be EC P-256 (decision 14). */
  private async fetchKey(signal: ProviderAbortSignal): Promise<KeyLoad> {
    return this.exchange(
      "verifyWebhook",
      { method: "GET", path: MONOBANK_PATHS.pubkey },
      signal,
      (answer) => {
        const key = publicKeyOf(answer.json);
        return key === undefined
          ? malformedAnswer(answer.status, "invalid_key")
          : { ok: true as const, key };
      },
    );
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

  /** One request; a 2xx goes to `read`, anything else is mapped to a failure and logged. */
  private async exchange<T>(
    operation: Operation,
    request: MonobankRequest,
    signal: ProviderAbortSignal,
    read: (answer: MonobankAnswer) => T | PaymentProviderFailure,
  ): Promise<T | PaymentProviderFailure> {
    const started = performance.now();
    const exchange: MonobankExchange = await this.http.call(request, signal);
    const elapsed = Math.round(performance.now() - started);
    if (exchange.kind === "failed") {
      const failure = failureOfExchange(exchange);
      this.logFailure(operation, "no answer", failure, elapsed);
      return failure;
    }
    const { answer } = exchange;
    const result =
      answer.status >= 200 && answer.status < 300 ? read(answer) : mapMonobankError(answer);
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
    if (failure.reason === "misconfigured" && failure.providerCodes.includes("403")) {
      if (!this.tokenRefusalLogged) {
        this.tokenRefusalLogged = true;
        this.logger.error(
          `${line}; Monobank refused the token: check MONOBANK_TOKEN (logged once per process)`,
        );
        return;
      }
    }
    this.logger.warn(line);
  }
}
