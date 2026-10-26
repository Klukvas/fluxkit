import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  validateOutgoingEmail,
  type EmailProviderFailureReason,
  type EmailProviderPort,
  type OutgoingEmail,
} from "@fluxkit/core";
import { CLOCK, type Clock } from "../../auth/clock.js";
import { summarizeError } from "../../common/error-summary.js";
import { DEFAULT_JOB_LIMITS, type JobLimits } from "../../common/job-limits.js";
import { LOCALE_CONFIG, type LocaleConfig } from "../../common/locale.js";
import { EmailProviderRegistry, type EmailProviderSource } from "../registry/index.js";
import {
  EMAIL_THEME,
  EmailRenderError,
  EmailTemplateRegistry,
  renderEmail,
  type EmailTemplateSource,
} from "../templates/index.js";
import { EMAIL_DELIVERY_CONFIG, type EmailDeliveryConfig } from "./email-delivery-config.js";
import { EMAIL_LINK_SOURCE, type EmailLinkSource } from "./email-links.js";
import { EmailMessageChanges, type ClaimedEmailMessage } from "./email-message-changes.js";
import type { EmailAttemptOutcome, NotRenderableCode } from "./email-outcome.js";
import { callEmailProvider, failureOfCall } from "./email-provider-call.js";
import { SendPacer } from "./send-pacer.js";

/** Injection token of the per-process `SendPacer` shared by job 9 and the immediate attempts. */
export const EMAIL_SEND_PACER = Symbol("fluxkit:email-send-pacer");

/** What one attempt on one mail did (job 9 counts these). Ids and codes only. */
export type EmailAttemptReport =
  /** No provider is loaded (`EMAIL_PROVIDER=none`): nothing claimed. */
  | { readonly kind: "no_provider" }
  /** Not due, gone, or held by another sender: nothing done. */
  | { readonly kind: "skipped" }
  /** Too many immediate attempts wait for the pacing: left to job 9. */
  | { readonly kind: "deferred" }
  /** Reached its deadline unsent at the claim. */
  | { readonly kind: "expired"; readonly status: "failed" | "unknown" }
  | {
      readonly kind: "sent" | "retry" | "failed" | "unknown";
      /** The provider's reason of a failed call (`undefined` when sent or not renderable). */
      readonly reason: EmailProviderFailureReason | undefined;
    }
  /** The attempt's row changed meanwhile (its lease expired and another sender claimed it): not recorded. */
  | { readonly kind: "lost" };

/** Provider answers that concern every mail, not one: job 9 stops its run on them instead of trying the next row. */
export const PROVIDER_WIDE_REASONS: readonly EmailProviderFailureReason[] = Object.freeze([
  "rate_limited",
  "quota_exceeded",
  "misconfigured",
]);

type Prepared =
  | { readonly kind: "ready"; readonly message: OutgoingEmail }
  | { readonly kind: "not_renderable"; readonly code: NotRenderableCode };

/**
 * Sends one claimed mail (ADR 0031 decision 6): claim (short transaction, committed) -> render from the stored template
 * key, version, locale and frozen variables, with the links derived now -> `validateOutgoingEmail` -> the provider, with
 * `idempotencyKey = email_message.id` and the API's time limit, NO transaction open -> record (short transaction). Used
 * by job 9 and by the immediate attempt of latency-critical mail (`sendNow`); both share the per-process pacing.
 *
 * Logs carry the message id, template key, attempt, status, codes and the duration; never the address, the variables,
 * the subject, a link or a provider's message text (ADR 0031 decision 8).
 */
@Injectable()
export class EmailSender {
  private readonly logger = new Logger("EmailSender");
  private readonly misconfiguredLogged = new Set<string>();
  private waitingWithoutProviderLogged = false;

  constructor(
    @Inject(EmailProviderRegistry) private readonly providers: EmailProviderSource,
    @Inject(EmailTemplateRegistry) private readonly templates: EmailTemplateSource,
    @Inject(EmailMessageChanges) private readonly changes: EmailMessageChanges,
    @Inject(EMAIL_DELIVERY_CONFIG) private readonly config: EmailDeliveryConfig,
    @Inject(EMAIL_LINK_SOURCE) private readonly links: EmailLinkSource,
    @Inject(LOCALE_CONFIG) private readonly locale: LocaleConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(EMAIL_SEND_PACER) private readonly pacer: SendPacer,
  ) {}

  /** The loaded provider, `undefined` with `EMAIL_PROVIDER=none`. */
  provider(): EmailProviderPort | undefined {
    return this.providers.get();
  }

  /**
   * One attempt on the mail `id`: claims it at `clock()`, sends it, records the result at `clock()` after the call.
   * Database errors of the claim or the record propagate (the caller logs them; the row stays due or leased and is tried
   * again); everything about the mail itself ends in a recorded status.
   */
  async attempt(
    id: string,
    clock: () => Date,
    limits: JobLimits = DEFAULT_JOB_LIMITS,
  ): Promise<EmailAttemptReport> {
    const provider = this.providers.get();
    if (provider === undefined) {
      return { kind: "no_provider" };
    }
    const claim = await this.changes.claim(id, clock(), provider.code, limits);
    if (claim.kind === "skipped") {
      return claim;
    }
    if (claim.kind === "expired") {
      this.logger.warn(`Email ${id}: deadline passed before it could be sent; ${claim.status}`);
      return claim;
    }
    const message = claim.message;
    const prepared = this.prepare(message);
    let outcome: EmailAttemptOutcome;
    let reason: EmailProviderFailureReason | undefined;
    let durationMs = 0;
    if (prepared.kind === "not_renderable") {
      outcome = prepared;
      this.logger.error(
        `Email ${message.id} (${message.templateKey}) cannot be rendered: ${prepared.code}; failed`,
      );
    } else {
      await this.pacer.acquire();
      const started = performance.now();
      const call = await callEmailProvider(
        provider,
        prepared.message,
        { idempotencyKey: message.id },
        this.config.tuning.sendTimeoutMs,
      );
      durationMs = Math.round(performance.now() - started);
      if (call.kind === "ok") {
        outcome = { kind: "sent", providerMessageId: call.providerMessageId };
      } else {
        const failure = failureOfCall(call);
        reason = failure.reason;
        outcome = { kind: "provider_failed", failure };
      }
    }
    const recorded = await this.changes.record(message, outcome, clock(), limits);
    if (recorded.kind === "lost") {
      this.logger.warn(
        `Email ${message.id} (${message.templateKey}) attempt ${String(message.attempts)}: not recorded, the row was claimed again meanwhile`,
      );
      return recorded;
    }
    const { decision } = recorded;
    this.logAttempt(
      message,
      provider.code,
      decision.status,
      decision.lastErrorCode,
      reason,
      durationMs,
    );
    const kind = decision.status === "pending" ? "retry" : decision.status;
    return { kind, reason };
  }

  /**
   * The immediate attempt of a latency-critical mail (a reset or verification link), called by the request process
   * AFTER its transaction committed. The same claim and record as job 9 at the injected clock's time, through the same
   * pacing; when too many immediate attempts already wait for it, the mail is left to job 9 (`deferred`).
   */
  async sendNow(id: string): Promise<EmailAttemptReport> {
    if (this.providers.get() === undefined) {
      return { kind: "no_provider" };
    }
    if (this.pacer.waiting() >= this.config.tuning.maxWaitingImmediate) {
      this.logger.warn(`Email ${id}: immediate attempt deferred to job 9 (pacing queue full)`);
      return { kind: "deferred" };
    }
    return this.attempt(id, () => this.clock.now());
  }

  /**
   * `sendNow` without waiting for it (fire and forget): the request answers at once. Any error is logged with the id
   * and the error class only; the mail stays due (or leased) and job 9 takes it.
   */
  startSendNow(id: string): void {
    void this.sendNow(id).catch((error: unknown) => {
      this.logger.error(
        `Email ${id}: immediate attempt failed (${summarizeError(error)}); job 9 retries it`,
      );
    });
  }

  /** Once per process: open mails wait while no provider is loaded (they stay pending and fail at their deadline). */
  warnWaitingWithoutProvider(open: number): void {
    if (open === 0 || this.waitingWithoutProviderLogged) {
      return;
    }
    this.waitingWithoutProviderLogged = true;
    this.logger.warn(
      `Email: ${String(open)} mails wait but no email provider is loaded (EMAIL_PROVIDER=none); they stay pending and fail at their deadline`,
    );
  }

  private prepare(message: ClaimedEmailMessage): Prepared {
    const from = this.config.from;
    if (from === null) {
      // EmailOutboxModule refuses to start with a provider and no EMAIL_FROM.
      throw new Error("EMAIL_FROM is not configured");
    }
    const entry = this.templates.get(message.templateKey);
    // The same stored input must give the same bytes on every attempt (R4): another version of the template cannot
    // render this mail. A deploy that raises a version fails the queued mails of that template; an admin resends them.
    if (entry === undefined || entry.template.version !== message.templateVersion) {
      return { kind: "not_renderable", code: "template_unavailable" };
    }
    let rendered;
    try {
      rendered = renderEmail(entry, message.variables, {
        locale: message.locale,
        defaultLocale: this.locale.defaultLocale,
        theme: EMAIL_THEME,
        links: this.links.linksFor({
          messageId: message.id,
          templateKey: message.templateKey,
          locale: message.locale,
          recipientKind: message.recipientKind,
          customerId: message.customerId,
          orderId: message.orderId,
          variables: message.variables,
        }),
        shopName: from.displayName,
      });
    } catch (error) {
      return {
        kind: "not_renderable",
        code: error instanceof EmailRenderError ? error.code : "render_failed",
      };
    }
    const outgoing: OutgoingEmail = {
      from,
      ...(this.config.replyTo === null ? {} : { replyTo: this.config.replyTo }),
      to: { address: message.toAddress, displayName: null },
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tags: { category: rendered.category },
    };
    const issues = validateOutgoingEmail(outgoing, message.id);
    if (issues.length > 0) {
      this.logger.error(
        `Email ${message.id} (${message.templateKey}) fails the outgoing checks: ${issues.map((issue) => `${issue.path}=${issue.code}`).join(" ")}`,
      );
      return { kind: "not_renderable", code: "message_invalid" };
    }
    return { kind: "ready", message: outgoing };
  }

  private logAttempt(
    message: ClaimedEmailMessage,
    providerCode: string,
    status: string,
    code: string | null,
    reason: EmailProviderFailureReason | undefined,
    durationMs: number,
  ): void {
    const line = `Email ${message.id} (${message.templateKey}) attempt ${String(message.attempts)} via ${providerCode}: ${status}${code === null ? "" : ` code=${code}`} in ${String(durationMs)} ms`;
    if (status === "sent") {
      this.logger.log(line);
    } else if (reason === "misconfigured" && code !== null) {
      // One error per process and code: the operator fixes the key or the domain; every mail retries hourly meanwhile.
      if (this.misconfiguredLogged.has(code)) {
        this.logger.warn(line);
      } else {
        this.misconfiguredLogged.add(code);
        this.logger.error(`${line}; the email provider is misconfigured (key or sending domain)`);
      }
    } else if (status === "pending") {
      this.logger.warn(line);
    } else {
      this.logger.error(line);
    }
  }
}
