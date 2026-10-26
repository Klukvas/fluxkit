import { appendFileSync } from "node:fs";
import { Injectable, SetMetadata } from "@nestjs/common";
import {
  EMAIL_PROVIDER_FAILURE_REASONS,
  EMAIL_PROVIDER_METADATA,
  emailProviderFailure,
  emailProviderMetadata,
  emailProviderOk,
  validateOutgoingEmail,
  type EmailProviderFailure,
  type EmailProviderFailureReason,
  type EmailProviderPort,
  type EmailProviderResult,
  type EmailQuotaPeriod,
  type EmailSendOptions,
  type EmailSent,
  type OutgoingEmail,
  type ProviderAbortSignal,
} from "@fluxkit/core";

/*
 * TEST-ONLY. A deterministic, in-memory email provider: no network, no clock, no randomness. It keeps every accepted mail
 * in a capture mailbox a test reads, and it can be told to fail. It exists so the email module, the provider loader and
 * the e2e suites have a provider that is always available. It must never be enabled in a real shop: it delivers nothing.
 * `loadEnv` refuses `EMAIL_PROVIDER=fake` when `NODE_ENV` is production.
 */

export const FAKE_EMAIL_PROVIDER_CODE = "fake";

/** A recipient whose local part is this word is refused with `rejected` / `recipient_refused` (the contract suite's refused mail). */
export const FAKE_REFUSED_LOCAL_PART = "refused";

/** One mail the fake accepted, as the fake service holds it. */
export interface CapturedEmail {
  /** The id the fake answered, `fake-email-NNNNNN` (counted per instance, restarts after `reset`). */
  readonly providerMessageId: string;
  readonly idempotencyKey: string;
  readonly message: OutgoingEmail;
}

/** What reached the fake service for one request that passed local validation (a replay of a key counts too). */
export interface FakeEmailRequest {
  readonly idempotencyKey: string;
  readonly recipients: readonly string[];
}

export interface FakeEmailFailure {
  /** Default `unavailable`. */
  readonly reason?: EmailProviderFailureReason;
  /** Raw service codes of the failure (`EMAIL_CODE_PATTERN`); default none. */
  readonly providerCodes?: readonly string[];
  /** The service's `retry-after` in seconds, for `rate_limited` and `quota_exceeded`. */
  readonly retryAfterSeconds?: number;
  /** Only with `quota_exceeded`. */
  readonly quotaPeriod?: EmailQuotaPeriod;
  /** How many sends fail. Default 1. */
  readonly times?: number;
  /**
   * The mail IS accepted and captured, but the answer is lost (the send fails with the given reason): the case where a
   * retry with the same idempotency key must NOT deliver a second copy. The fake then replays the first answer.
   */
  readonly afterEffect?: boolean;
  /** The send never answers until its abort signal fires, then rejects with its reason (reproduces a timeout). */
  readonly hang?: boolean;
}

interface PlannedFailure {
  readonly failure: EmailProviderFailure;
  readonly afterEffect: boolean;
  readonly hang: boolean;
  remaining: number;
}

export interface FakeEmailProviderOptions {
  /** `FAKE_EMAIL_CAPTURE_FILE`: an absolute path; every accepted mail is also appended there as one JSON line (e2e only). */
  readonly captureFile?: string;
}

function fingerprint(message: OutgoingEmail): string {
  return JSON.stringify(message);
}

@Injectable()
@SetMetadata(EMAIL_PROVIDER_METADATA, emailProviderMetadata(FAKE_EMAIL_PROVIDER_CODE))
export class FakeEmailProvider implements EmailProviderPort {
  readonly code = FAKE_EMAIL_PROVIDER_CODE;
  readonly capabilities = Object.freeze({ idempotencyKeys: true, maxRecipients: 1 });

  private readonly captured: CapturedEmail[] = [];
  private readonly received: FakeEmailRequest[] = [];
  private readonly byKey = new Map<string, { fingerprint: string; providerMessageId: string }>();
  private planned: PlannedFailure | undefined;

  constructor(private readonly options: FakeEmailProviderOptions = {}) {}

  /*
   * Test hooks. Not part of EmailProviderPort; a test reaches them by `app.get(FakeEmailProvider)` or a cast of the
   * registry's answer. They act inside one process: a separate API process cannot be told to fail.
   */

  /** Makes the next `times` (default 1) sends fail as described. Replaces an earlier plan. A bad description throws now. */
  failNext(failure: FakeEmailFailure = {}): void {
    const times = failure.times ?? 1;
    if (!Number.isInteger(times) || times < 1) {
      throw new RangeError("failNext: times must be a positive integer");
    }
    const reason = failure.reason ?? "unavailable";
    if (!EMAIL_PROVIDER_FAILURE_REASONS.includes(reason)) {
      throw new RangeError(`Unknown email failure reason: ${String(reason)}`);
    }
    this.planned = {
      failure: emailProviderFailure(reason, {
        providerCodes: failure.providerCodes,
        ...(failure.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: failure.retryAfterSeconds }),
        ...(failure.quotaPeriod === undefined ? {} : { quotaPeriod: failure.quotaPeriod }),
      }),
      afterEffect: failure.afterEffect === true,
      hang: failure.hang === true,
      remaining: times,
    };
  }

  /** The capture mailbox: every accepted mail, oldest first (a replay of a key adds nothing). */
  mailbox(): readonly CapturedEmail[] {
    return [...this.captured];
  }

  /** Every request that passed local validation, oldest first, including refused ones and replays. */
  requests(): readonly FakeEmailRequest[] {
    return [...this.received];
  }

  /** Forgets the mailbox, the requests, the idempotency keys and any planned failure; numbering restarts. */
  reset(): void {
    this.captured.length = 0;
    this.received.length = 0;
    this.byKey.clear();
    this.planned = undefined;
  }

  send(
    message: OutgoingEmail,
    options: EmailSendOptions,
    signal: ProviderAbortSignal,
  ): Promise<EmailProviderResult<EmailSent>> {
    // Nothing leaves the process before these two checks, so both are `not_sent` (always safe to retry).
    if (signal.aborted) {
      return Promise.resolve(emailProviderFailure("not_sent", { providerCodes: ["aborted"] }));
    }
    if (validateOutgoingEmail(message, options.idempotencyKey).length > 0) {
      return Promise.resolve(
        emailProviderFailure("not_sent", { providerCodes: ["invalid_message"] }),
      );
    }
    this.received.push({
      idempotencyKey: options.idempotencyKey,
      recipients: [message.to.address],
    });
    const planned = this.takePlanned();
    if (planned?.hang === true) {
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }
    if (planned !== undefined && !planned.afterEffect) {
      return Promise.resolve(planned.failure);
    }
    const accepted = this.accept(message, options.idempotencyKey);
    return Promise.resolve(planned === undefined ? accepted : planned.failure);
  }

  private takePlanned(): PlannedFailure | undefined {
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

  /** The fake service: refuses its refused recipient, deduplicates by key like Resend, captures what it accepts. */
  private accept(message: OutgoingEmail, idempotencyKey: string): EmailProviderResult<EmailSent> {
    if (message.to.address.split("@")[0] === FAKE_REFUSED_LOCAL_PART) {
      return emailProviderFailure("rejected", { providerCodes: ["recipient_refused"] });
    }
    const known = this.byKey.get(idempotencyKey);
    if (known !== undefined) {
      return known.fingerprint === fingerprint(message)
        ? emailProviderOk({ providerMessageId: known.providerMessageId })
        : emailProviderFailure("idempotency_conflict", {
            providerCodes: ["invalid_idempotent_request"],
          });
    }
    const providerMessageId = `fake-email-${String(this.captured.length + 1).padStart(6, "0")}`;
    this.byKey.set(idempotencyKey, { fingerprint: fingerprint(message), providerMessageId });
    this.captured.push({ providerMessageId, idempotencyKey, message });
    if (this.options.captureFile !== undefined) {
      appendFileSync(
        this.options.captureFile,
        `${JSON.stringify({ providerMessageId, idempotencyKey, ...message })}\n`,
        "utf8",
      );
    }
    return emailProviderOk({ providerMessageId });
  }
}
