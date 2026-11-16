import { Controller, HttpCode, Inject, Logger, Param, Post, Req, UseFilters } from "@nestjs/common";
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  EMAIL_WEBHOOK_MAX_FACTS,
  validateEmailSuppressionFact,
  type EmailSuppressionFact,
} from "@fluxkit/core";
import { CLOCK, type Clock } from "../../auth/clock.js";
import { ApiProblemResponses } from "../../common/openapi.js";
import { notFound, tooManyRequests, unauthorized, validationFailed } from "../../common/problem.js";
import { RateLimit } from "../../rate-limit/rate-limit.decorator.js";
import { EmailProviderRegistry } from "../registry/index.js";
import { EmailSuppressionService } from "../suppression/email-suppression.service.js";
import {
  RAW_EMAIL_WEBHOOK_BODY,
  type RequestWithRawEmailWebhookBody,
} from "./email-webhook-raw-body.js";

import { EmailWebhookExceptionFilter } from "./email-webhook-exception.filter.js";

/** No browser session/CSRF: the selected plugin authenticates exact raw bytes before JSON parsing. */
@ApiTags("webhooks")
@Controller("webhooks/email")
@UseFilters(EmailWebhookExceptionFilter)
export class EmailWebhookController {
  private readonly logger = new Logger("EmailWebhook");
  constructor(
    @Inject(EmailProviderRegistry) private readonly registry: EmailProviderRegistry,
    @Inject(EmailSuppressionService) private readonly suppression: EmailSuppressionService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Post(":provider")
  @HttpCode(204)
  @RateLimit("emailWebhook")
  @ApiOperation({
    summary: "Receive authenticated email suppression feedback",
    description:
      "Configured primary and fallback providers only, with webhook credentials configured. Maximum 64 KiB. 204 only after commit, also for duplicate/ignored events. Event age must be within seven days old and five minutes future. Controller, guard and raw-body server failures return 429 with Retry-After: 5 so Brevo retries instead of discarding on 5xx. Ingestion uses transaction-local 2-second lock and 5-second statement timeouts.",
  })
  @ApiParam({
    name: "provider",
    description: "The selected email provider code (resend or brevo).",
  })
  @ApiBody({
    description: "Provider-specific JSON, authenticated before parsing exact raw bytes.",
    schema: { type: "object" },
  })
  @ApiResponse({ status: 204, description: "Committed, duplicate or ignored. Empty body." })
  @ApiProblemResponses(400, 401, 404, 413, 429)
  async receive(
    @Param("provider") code: string,
    @Req() request: RequestWithRawEmailWebhookBody,
  ): Promise<void> {
    const provider = this.registry.get(code);
    if (provider === undefined || provider.code !== code || provider.webhookVerifier === undefined)
      throw notFound("Email webhook");
    const now = this.clock.now();
    let result;
    try {
      result = provider.webhookVerifier({
        headers: request.headers,
        rawBody: request[RAW_EMAIL_WEBHOOK_BODY] ?? Buffer.alloc(0),
        now,
      });
    } catch {
      this.logger.error("email_webhook_verifier_failed");
      throw tooManyRequests("The notification could not be recorded. Retry later.", 5);
    }
    if (!result.ok) {
      if (result.reason === "unauthenticated")
        throw unauthorized("The notification could not be verified.");
      this.logger.warn(
        result.reason === "stale" ? "email_webhook_stale" : "email_webhook_malformed",
      );
      throw validationFailed([], "The notification could not be read.");
    }
    if (!Array.isArray(result.facts) || result.facts.length > EMAIL_WEBHOOK_MAX_FACTS)
      throw validationFailed([], "The notification could not be read.");
    const facts: EmailSuppressionFact[] = [];
    for (const candidate of result.facts) {
      const checked = validateEmailSuppressionFact(candidate, now);
      if (!checked.ok) {
        this.logger.warn(
          checked.reason === "stale" ? "email_webhook_event_stale" : "email_webhook_fact_malformed",
        );
        throw validationFailed([], "The notification could not be read.");
      }
      facts.push(checked.fact);
    }
    if (facts.length === 0) return;
    try {
      await this.suppression.ingest(provider.code, facts, now);
    } catch {
      // Never log DB error messages: query parameters can carry recipient addresses.
      this.logger.error("email_webhook_commit_failed");
      throw tooManyRequests("The notification could not be recorded. Retry later.", 5);
    }
  }
}
