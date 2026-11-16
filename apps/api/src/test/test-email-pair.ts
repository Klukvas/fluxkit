import { Injectable, Module, SetMetadata } from "@nestjs/common";
import {
  EMAIL_PROVIDER_METADATA,
  emailProviderMetadata,
  type EmailWebhookVerifier,
} from "@fluxkit/core";
import type { LoadedEmailProvider } from "../email/registry/index.js";
import { TestEmailProvider } from "./test-email-provider.js";

/** Test-only authenticated feedback boundary. No real provider credentials or external HTTP. */
const verifier: EmailWebhookVerifier = (input) =>
  input.headers.authorization === "Bearer test-email-feedback-token"
    ? { ok: true, facts: [], ignored: true }
    : { ok: false, reason: "unauthenticated" };

@Injectable()
@SetMetadata(EMAIL_PROVIDER_METADATA, emailProviderMetadata("fake"))
export class TestPrimaryEmailProvider extends TestEmailProvider {
  readonly webhookVerifier = verifier;
}

@Injectable()
@SetMetadata(EMAIL_PROVIDER_METADATA, emailProviderMetadata("fake_fallback"))
export class TestFallbackEmailProvider extends TestEmailProvider {
  override readonly code = "fake_fallback";
  readonly webhookVerifier = verifier;
}

@Module({ providers: [TestPrimaryEmailProvider], exports: [TestPrimaryEmailProvider] })
class PrimaryModule {}
@Module({ providers: [TestFallbackEmailProvider], exports: [TestFallbackEmailProvider] })
class FallbackModule {}

export function testEmailPair(): LoadedEmailProvider[] {
  return [
    { code: "fake", module: PrimaryModule },
    { code: "fake_fallback", module: FallbackModule },
  ];
}
