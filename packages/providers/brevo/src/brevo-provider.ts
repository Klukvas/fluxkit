import { Inject, Injectable, Optional, SetMetadata } from "@nestjs/common";
import {
  EMAIL_LIMITS,
  EMAIL_PROVIDER_METADATA,
  emailProviderFailure,
  emailProviderMetadata,
  validateOutgoingEmail,
  type EmailProviderFailure,
  type EmailProviderPort,
  type EmailProviderResult,
  type EmailSendOptions,
  type EmailSent,
  type OutgoingEmail,
  type ProviderAbortSignal,
  type EmailWebhookVerifier,
} from "@fluxkit/core";
import { mapBrevoAnswer } from "./answer-map.js";
import { BrevoHttp, type BrevoExchange } from "./http.js";
import { brevoBodyOf } from "./request.js";

/** One POST per send; only local validation/pre-abort proves not_sent. No startup network calls.
 * TODO(fluxkit): not live-verified — B2 inline deduplication. Until verified, ambiguity is never replayed.
 * After owner verification declare idempotencyKeys=true and idempotencyWindowSeconds=1800.
 */
export const BREVO_PROVIDER_CODE = "brevo";

/** Nest token of the `BrevoHttp` instance (the module's factory builds it from `BREVO_API_KEY`). */
export const BREVO_HTTP = Symbol("BREVO_HTTP");
/** Nest token of the logger. */
export const BREVO_LOGGER = Symbol("BREVO_LOGGER");
export const BREVO_WEBHOOK_VERIFIER = Symbol("BREVO_WEBHOOK_VERIFIER");

export interface BrevoLogger {
  warn(message: string): void;
}

function failureOfExchange(
  exchange: Exclude<BrevoExchange, { kind: "answered" }>,
): EmailProviderFailure {
  if (exchange.code === "aborted_before_send") {
    return emailProviderFailure("not_sent", { providerCodes: ["aborted"] });
  }
  return emailProviderFailure("unavailable", {
    providerCodes:
      exchange.status === undefined ? [exchange.code] : [exchange.code, String(exchange.status)],
  });
}

@Injectable()
@SetMetadata(EMAIL_PROVIDER_METADATA, emailProviderMetadata(BREVO_PROVIDER_CODE))
export class BrevoEmailProvider implements EmailProviderPort {
  readonly code = BREVO_PROVIDER_CODE;
  /** This plugin sends exactly one recipient per request (ADR 0031 decision 16). */
  readonly capabilities = Object.freeze({ idempotencyKeys: false, maxRecipients: 1 });

  constructor(
    @Inject(BREVO_HTTP) private readonly http: BrevoHttp,
    @Inject(BREVO_LOGGER) private readonly logger: BrevoLogger,
    @Optional() @Inject(BREVO_WEBHOOK_VERIFIER) readonly webhookVerifier?: EmailWebhookVerifier,
  ) {}

  async send(
    message: OutgoingEmail,
    options: EmailSendOptions,
    signal: ProviderAbortSignal,
  ): Promise<EmailProviderResult<EmailSent>> {
    const issues = validateOutgoingEmail(message, options.idempotencyKey);
    if (issues.length > 0) {
      // Our own issue codes (a path and a reason, e.g. `to.forbidden_character`), never a value.
      const issueCodes = issues.map((issue) => `${issue.path}.${issue.code}`);
      return emailProviderFailure("not_sent", {
        providerCodes: ["invalid_message", ...issueCodes].slice(0, EMAIL_LIMITS.maxProviderCodes),
      });
    }
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        options.idempotencyKey,
      )
    ) {
      return emailProviderFailure("not_sent", {
        providerCodes: ["invalid_message", "idempotencyKey.invalid"],
      });
    }
    const started = performance.now();
    const exchange = await this.http.postEmail(
      JSON.stringify(brevoBodyOf(message, options.idempotencyKey)),
      signal,
    );
    const result =
      exchange.kind === "answered" ? mapBrevoAnswer(exchange.answer) : failureOfExchange(exchange);
    if (!result.ok) {
      const status =
        exchange.kind === "answered" ? `HTTP ${String(exchange.answer.status)}` : "no answer";
      this.logger.warn(
        `send: ${status} -> ${result.reason} (${result.providerCodes.join(",")}) after ${String(Math.round(performance.now() - started))} ms`,
      );
    }
    return result;
  }
}
