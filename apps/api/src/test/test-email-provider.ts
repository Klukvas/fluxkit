import { Injectable, Module, SetMetadata, type Type } from "@nestjs/common";
import {
  EMAIL_PROVIDER_METADATA,
  emailProviderFailure,
  emailProviderMetadata,
  emailProviderOk,
  type EmailProviderFailureReason,
  type EmailProviderPort,
  type EmailProviderResult,
  type EmailSendOptions,
  type EmailSent,
  type OutgoingEmail,
  type ProviderAbortSignal,
} from "@fluxkit/core";
import type { LoadedEmailProvider } from "../email/registry/index.js";

/**
 * Code of the in-repo test email provider. Specs mount it with `startApp({ extraEmailProviders: testEmailProviders() })`,
 * so core and API specs need nothing from `packages/providers` (the package `_fake-email` has its own specs).
 */
export const TEST_EMAIL_PROVIDER_CODE = "fake";

export interface TestEmailFailure {
  reason?: EmailProviderFailureReason;
  providerCodes?: readonly string[];
  retryAfterSeconds?: number;
  /** How many sends fail. Default 1. */
  times?: number;
}

export interface TestSentEmail {
  readonly message: OutgoingEmail;
  readonly idempotencyKey: string;
  readonly providerMessageId: string;
}

/** Keeps every accepted mail in memory and fails on request. Reach it with `app.get(TestEmailProvider)`. */
@Injectable()
@SetMetadata(EMAIL_PROVIDER_METADATA, emailProviderMetadata(TEST_EMAIL_PROVIDER_CODE))
export class TestEmailProvider implements EmailProviderPort {
  readonly code = TEST_EMAIL_PROVIDER_CODE;
  readonly capabilities = Object.freeze({ idempotencyKeys: true, maxRecipients: 1 });

  readonly sent: TestSentEmail[] = [];
  private failure: (TestEmailFailure & { remaining: number }) | undefined;

  failNext(failure: TestEmailFailure = {}): void {
    this.failure = { ...failure, remaining: failure.times ?? 1 };
  }

  reset(): void {
    this.sent.length = 0;
    this.failure = undefined;
  }

  send(
    message: OutgoingEmail,
    options: EmailSendOptions,
    signal: ProviderAbortSignal,
  ): Promise<EmailProviderResult<EmailSent>> {
    if (signal.aborted) {
      return Promise.resolve(emailProviderFailure("not_sent"));
    }
    if (this.failure !== undefined) {
      const planned = this.failure;
      planned.remaining -= 1;
      if (planned.remaining <= 0) {
        this.failure = undefined;
      }
      return Promise.resolve(
        emailProviderFailure(planned.reason ?? "unavailable", {
          providerCodes: planned.providerCodes,
          retryAfterSeconds: planned.retryAfterSeconds,
        }),
      );
    }
    const providerMessageId = `test-email-${String(this.sent.length + 1).padStart(6, "0")}`;
    this.sent.push({ message, idempotencyKey: options.idempotencyKey, providerMessageId });
    return Promise.resolve(emailProviderOk({ providerMessageId }));
  }
}

@Module({ providers: [TestEmailProvider], exports: [TestEmailProvider] })
class TestEmailProviderModule {}

/** The in-repo test email provider as a loaded module: `startApp({ extraEmailProviders: testEmailProviders() })`. */
export function testEmailProviders(): LoadedEmailProvider[] {
  return [{ code: TEST_EMAIL_PROVIDER_CODE, module: TestEmailProviderModule as Type<unknown> }];
}
