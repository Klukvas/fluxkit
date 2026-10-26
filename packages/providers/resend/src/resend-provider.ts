import { Inject, Injectable, SetMetadata } from "@nestjs/common";
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
} from "@fluxkit/core";
import { mapResendAnswer } from "./answer-map.js";
import { ResendHttp, type ResendExchange } from "./http.js";
import { resendBodyOf } from "./request.js";

/*
 * The Resend email provider (code `resend`; ADR 0031 decisions 3, 6, 16 and 17; plan section 2 and step 6). One call of
 * `send` makes at most ONE request to Resend and never repeats it: a retry is the outbox's decision and goes out with the
 * same idempotency key (the `email_message.id`), which Resend deduplicates for 24 hours (R4).
 * - `not_sent` only when nothing left the process: a message that fails core `validateOutgoingEmail` (checked before
 *   any request), a signal that had fired before the request (`ResendHttp` checks it right before `fetch`).
 * - Every other failure is mapped from Resend's answer (`mapResendAnswer`) or from the transport (`unavailable`: a
 *   timeout or network failure may have sent).
 * - Logs: the outcome as reason, codes, status and duration; never the key, an address, a subject, a body or Resend's
 *   text (a warning per failure; nothing on success, the API logs that).
 */

export const RESEND_PROVIDER_CODE = "resend";

/** Nest token of the `ResendHttp` instance (the module's factory builds it from `RESEND_API_KEY`). */
export const RESEND_HTTP = Symbol("RESEND_HTTP");
/** Nest token of the logger. */
export const RESEND_LOGGER = Symbol("RESEND_LOGGER");

export interface ResendLogger {
  warn(message: string): void;
}

function failureOfExchange(
  exchange: Exclude<ResendExchange, { kind: "answered" }>,
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
@SetMetadata(EMAIL_PROVIDER_METADATA, emailProviderMetadata(RESEND_PROVIDER_CODE))
export class ResendEmailProvider implements EmailProviderPort {
  readonly code = RESEND_PROVIDER_CODE;
  /** Resend accepts up to 50 recipients (R2), but this plugin sends exactly one per request (v1, decision 16). */
  readonly capabilities = Object.freeze({ idempotencyKeys: true, maxRecipients: 1 });

  constructor(
    @Inject(RESEND_HTTP) private readonly http: ResendHttp,
    @Inject(RESEND_LOGGER) private readonly logger: ResendLogger,
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
    const started = performance.now();
    const exchange = await this.http.postEmail(
      JSON.stringify(resendBodyOf(message)),
      options.idempotencyKey,
      signal,
    );
    const result =
      exchange.kind === "answered" ? mapResendAnswer(exchange.answer) : failureOfExchange(exchange);
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
