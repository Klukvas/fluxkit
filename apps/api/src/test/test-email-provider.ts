import { Injectable, Module, SetMetadata, type Type } from "@nestjs/common";
import {
  EMAIL_PROVIDER_METADATA,
  emailProviderFailure,
  emailProviderMetadata,
  emailProviderOk,
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
import type { LoadedEmailProvider } from "../email/registry/index.js";

/**
 * Code of the in-repo test email provider. Specs mount it with `startApp({ extraEmailProviders: testEmailProviders() })`,
 * so core and API specs need nothing from `packages/providers` (the package `_fake-email` has its own specs). It behaves
 * like the service the outbox talks to: it deduplicates by idempotency key (a replay of a key with the same message
 * answers the first id; another message under the key is `idempotency_conflict`, Resend R4).
 */
export const TEST_EMAIL_PROVIDER_CODE = "fake";

export interface TestEmailFailure {
  /** Default `unavailable`. */
  reason?: EmailProviderFailureReason;
  providerCodes?: readonly string[];
  retryAfterSeconds?: number;
  /** Only with `quota_exceeded`. */
  quotaPeriod?: EmailQuotaPeriod;
  /** How many sends fail. Default 1. */
  times?: number;
  /** The mail IS accepted (and kept), but the answer is lost: the send answers the failure instead. */
  afterEffect?: boolean;
  /** The send never answers until its abort signal fires, then rejects with the signal's reason (a timeout). */
  hang?: boolean;
  /** The send throws (rejects) instead of answering a result. */
  throws?: boolean;
}

export interface TestSentEmail {
  readonly message: OutgoingEmail;
  readonly idempotencyKey: string;
  readonly providerMessageId: string;
}

interface Planned {
  readonly failure: EmailProviderFailure;
  readonly afterEffect: boolean;
  readonly hang: boolean;
  readonly throws: boolean;
  remaining: number;
}

/** Keeps every accepted mail in memory and fails on request. Reach it with `app.get(TestEmailProvider)`. */
@Injectable()
@SetMetadata(EMAIL_PROVIDER_METADATA, emailProviderMetadata(TEST_EMAIL_PROVIDER_CODE))
export class TestEmailProvider implements EmailProviderPort {
  readonly code = TEST_EMAIL_PROVIDER_CODE;
  readonly capabilities = Object.freeze({ idempotencyKeys: true, maxRecipients: 1 });

  /** Accepted mails, oldest first; a replay of a key adds nothing. */
  readonly sent: TestSentEmail[] = [];
  /** The idempotency key of every send call, oldest first (replays and failures included). */
  readonly calls: string[] = [];
  private readonly byKey = new Map<string, { body: string; providerMessageId: string }>();
  private planned: Planned | undefined;

  failNext(failure: TestEmailFailure = {}): void {
    this.planned = {
      failure: emailProviderFailure(failure.reason ?? "unavailable", {
        providerCodes: failure.providerCodes,
        ...(failure.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: failure.retryAfterSeconds }),
        ...(failure.quotaPeriod === undefined ? {} : { quotaPeriod: failure.quotaPeriod }),
      }),
      afterEffect: failure.afterEffect === true,
      hang: failure.hang === true,
      throws: failure.throws === true,
      remaining: failure.times ?? 1,
    };
  }

  reset(): void {
    this.sent.length = 0;
    this.calls.length = 0;
    this.byKey.clear();
    this.planned = undefined;
  }

  send(
    message: OutgoingEmail,
    options: EmailSendOptions,
    signal: ProviderAbortSignal,
  ): Promise<EmailProviderResult<EmailSent>> {
    if (signal.aborted) {
      return Promise.resolve(emailProviderFailure("not_sent"));
    }
    this.calls.push(options.idempotencyKey);
    const planned = this.take();
    if (planned?.hang === true) {
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }
    if (planned?.throws === true) {
      return Promise.reject(new Error("test provider failure carrying shop@example.com"));
    }
    if (planned !== undefined && !planned.afterEffect) {
      return Promise.resolve(planned.failure);
    }
    const accepted = this.accept(message, options.idempotencyKey);
    return Promise.resolve(planned === undefined ? accepted : planned.failure);
  }

  private take(): Planned | undefined {
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

  private accept(message: OutgoingEmail, idempotencyKey: string): EmailProviderResult<EmailSent> {
    const body = JSON.stringify(message);
    const known = this.byKey.get(idempotencyKey);
    if (known !== undefined) {
      return known.body === body
        ? emailProviderOk({ providerMessageId: known.providerMessageId })
        : emailProviderFailure("idempotency_conflict", {
            providerCodes: ["invalid_idempotent_request"],
          });
    }
    const providerMessageId = `test-email-${String(this.sent.length + 1).padStart(6, "0")}`;
    this.byKey.set(idempotencyKey, { body, providerMessageId });
    this.sent.push({ message, idempotencyKey, providerMessageId });
    return emailProviderOk({ providerMessageId });
  }
}

@Module({ providers: [TestEmailProvider], exports: [TestEmailProvider] })
class TestEmailProviderModule {}

/** The in-repo test email provider as a loaded module: `startApp({ extraEmailProviders: testEmailProviders() })`. */
export function testEmailProviders(): LoadedEmailProvider[] {
  return [{ code: TEST_EMAIL_PROVIDER_CODE, module: TestEmailProviderModule as Type<unknown> }];
}
