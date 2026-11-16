import { Module, SetMetadata, type Type } from "@nestjs/common";
import {
  EMAIL_PROVIDER_METADATA,
  emailProviderMetadata,
  type EmailWebhookVerifier,
} from "@fluxkit/core";
import { TestEmailProvider } from "./test-email-provider.js";

const verifier: EmailWebhookVerifier = () => ({ ok: false, reason: "unauthenticated" });

/**
 * Test-only provider module shaped like a real provider package: creating it requires its API key variable, and it exposes
 * a webhook verifier only when its webhook secret variable is set. Core specs use it instead of `packages/providers`, so
 * they pass with every provider package deleted (feature matrix `providers-deleted`).
 */
export function envGatedEmailProviderModule(
  code: string,
  keyVariable: string,
  secretVariable: string,
): Type<unknown> {
  class EnvGatedEmailProvider extends TestEmailProvider {
    override readonly code = code;
    readonly webhookVerifier: EmailWebhookVerifier | undefined;

    constructor() {
      super();
      if (!process.env[keyVariable]) throw new Error(`${keyVariable} is required.`);
      this.webhookVerifier = process.env[secretVariable] ? verifier : undefined;
    }
  }
  SetMetadata(EMAIL_PROVIDER_METADATA, emailProviderMetadata(code))(EnvGatedEmailProvider);

  @Module({ providers: [EnvGatedEmailProvider], exports: [EnvGatedEmailProvider] })
  class EnvGatedEmailProviderModule {}
  return EnvGatedEmailProviderModule;
}
