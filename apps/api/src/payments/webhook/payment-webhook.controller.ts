import { createHash } from "node:crypto";
import { Controller, HttpCode, Inject, Logger, Param, Post, Req } from "@nestjs/common";
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  buildWebhookDedupeKey,
  isProviderPaymentFact,
  type ProviderPaymentFact,
} from "@fluxkit/core";
import { CLOCK, type Clock } from "../../auth/clock.js";
import { summarizeError } from "../../common/error-summary.js";
import { ApiProblemResponses } from "../../common/openapi.js";
import {
  notFound,
  ProblemException,
  serviceUnavailable,
  unauthorized,
  validationFailed,
} from "../../common/problem.js";
import { RateLimit } from "../../rate-limit/rate-limit.decorator.js";
import { PaymentFactsService } from "../payment-facts.service.js";
import { callPaymentProvider, describePaymentCall } from "../payment-provider-call.js";
import { PAYMENTS_CONFIG, type PaymentsConfig } from "../payments-config.js";
import { PaymentProviderRegistry } from "../registry/index.js";
import { RAW_WEBHOOK_BODY, type RequestWithRawWebhookBody } from "./webhook-raw-body.js";

const JSON_CONTENT_TYPE = /^application\/json(\s*;.*)?$/i;

/** Request headers as the provider port takes them: lower-case names, one string each. */
function headersOf(request: RequestWithRawWebhookBody): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") {
      headers[name.toLowerCase()] = value;
    } else if (Array.isArray(value)) {
      headers[name.toLowerCase()] = value.join(", ");
    }
  }
  return headers;
}

/**
 * `POST /webhooks/payments/{provider}` (ADR 0032 decision 12; red zone: an unauthenticated public route). The caller is
 * the payment provider: no session, no CSRF (the route is outside `/store` and `/admin`, whose guards do not apply), JSON
 * only, at most 64 KiB, limit `paymentWebhook` per address. The raw body bytes are read by `paymentWebhookRawBody` (app
 * factory) before any parser, and the signature is checked by the provider port over EXACTLY those bytes BEFORE anything
 * of the body is read: an invalid signature is `401` with no detail and stores nothing. A verified fact goes through
 * `PaymentFactsService` (dedupe by the SHA-256 of the raw body, binding, ordering, `markPaidIn`) in one transaction; the
 * answer is `200` with an empty body once it is durably recorded, also for a duplicate and for an attempt we do not know
 * (a retry would not help). A database failure answers `503` so the provider sends it again (Monobank: up to 3 more
 * times, M9). No outbound call on this path except what the plugin needs to verify (its key refetch). Bodies,
 * signatures and headers are never logged.
 */
@ApiTags("webhooks")
@Controller("webhooks/payments")
export class PaymentWebhookController {
  private readonly logger = new Logger("PaymentWebhook");

  constructor(
    @Inject(PaymentProviderRegistry) private readonly registry: PaymentProviderRegistry,
    @Inject(PaymentFactsService) private readonly facts: PaymentFactsService,
    @Inject(PAYMENTS_CONFIG) private readonly config: PaymentsConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Post(":provider")
  @HttpCode(200)
  @RateLimit("paymentWebhook")
  @ApiOperation({
    summary: "Receive a payment provider's signed status notification",
    description:
      "Called by the payment provider, never by a browser. The signature is verified over the exact raw body bytes before anything is parsed. 200 with an empty body once the fact is recorded (also for a duplicate or an unknown payment); 401 for a missing or invalid signature; 404 when the provider is not enabled; 503 when it could not be recorded (the provider retries).",
  })
  @ApiParam({ name: "provider", description: "An enabled payment provider code, e.g. `monobank`." })
  @ApiBody({
    description: "The provider's own JSON notification, verified by its signature header.",
    schema: { type: "object" },
  })
  @ApiResponse({ status: 200, description: "Recorded (or a duplicate, or not ours). Empty body." })
  @ApiProblemResponses(400, 401, 404, 413, 415, 429, 503)
  async receive(
    @Param("provider") code: string,
    @Req() request: RequestWithRawWebhookBody,
  ): Promise<void> {
    const provider = this.registry.get(code);
    if (provider === undefined) {
      throw notFound("Payment provider");
    }
    if (!JSON_CONTENT_TYPE.test(request.headers["content-type"] ?? "")) {
      throw new ProblemException({
        code: "validation_failed",
        status: 415,
        detail: "The notification must be JSON.",
      });
    }
    const rawBody = request[RAW_WEBHOOK_BODY] ?? Buffer.alloc(0);
    const verified = await callPaymentProvider<ProviderPaymentFact>(
      (signal) =>
        provider.verifyWebhook(
          { headers: headersOf(request), rawBody: new Uint8Array(rawBody) },
          signal,
        ),
      this.config.providerTimeoutMs,
    );
    if (!verified.result.ok) {
      const { reason } = verified.result;
      if (reason === "invalid_signature") {
        this.logger.warn(`Payment webhook of provider ${provider.code}: invalid signature`);
        throw unauthorized("The notification could not be verified.");
      }
      this.logger.warn(
        `Payment webhook of provider ${provider.code}: verifyWebhook ${describePaymentCall(verified)}`,
      );
      if (reason === "rejected" || reason === "not_found") {
        throw validationFailed([], "The notification could not be read.");
      }
      throw serviceUnavailable(5);
    }
    const fact = verified.result.value;
    if (!isProviderPaymentFact(fact)) {
      this.logger.error(
        `Payment webhook of provider ${provider.code}: the provider answered a malformed fact`,
      );
      throw validationFailed([], "The notification could not be read.");
    }
    const dedupeKey = buildWebhookDedupeKey(createHash("sha256").update(rawBody).digest("hex"));
    try {
      const result = await this.facts.applyProviderFact({
        providerCode: provider.code,
        fact,
        source: "webhook",
        webhookDedupeKey: dedupeKey,
        now: this.clock.now(),
      });
      if (result.kind === "unknown_attempt") {
        this.logger.warn(
          `Payment webhook of provider ${provider.code}: no attempt for payment ${fact.providerPaymentId}; ignored`,
        );
      }
    } catch (error) {
      // The class and the cause only: a database error text embeds the statement and its parameters.
      this.logger.error(
        `Payment webhook of provider ${provider.code}: not recorded: ${summarizeError(error)}`,
      );
      throw serviceUnavailable(5);
    }
  }
}
