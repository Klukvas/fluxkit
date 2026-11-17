import { isAbsolute } from "node:path";
import { Module } from "@nestjs/common";
import { FakeEmailProvider } from "./fake-email-provider.js";

export {
  FAKE_EMAIL_PROVIDER_CODE,
  FAKE_REFUSED_LOCAL_PART,
  FakeEmailProvider,
  type CapturedEmail,
  type FakeEmailFailure,
  type FakeEmailProviderOptions,
  type FakeEmailRequest,
} from "./fake-email-provider.js";

/**
 * Reads `FAKE_EMAIL_CAPTURE_FILE`: unset or blank means no file; anything else must be an absolute path without a NUL
 * byte. The error names the variable only.
 */
export function parseFakeEmailCaptureFile(
  source: Record<string, string | undefined>,
): string | undefined {
  const value = source.FAKE_EMAIL_CAPTURE_FILE;
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  if (value.includes("\0") || !isAbsolute(value)) {
    throw new Error("FAKE_EMAIL_CAPTURE_FILE must be an absolute file path.");
  }
  return value;
}

/**
 * Entry point read by the API's email provider loader (named export `providerModule`, ADR 0031 decision 4). It is only
 * mounted when `EMAIL_PROVIDER=fake`. Test-only: never enable it in a real shop.
 */
@Module({
  providers: [
    {
      provide: FakeEmailProvider,
      useFactory: () =>
        new FakeEmailProvider({ captureFile: parseFakeEmailCaptureFile(process.env) }),
    },
  ],
  exports: [FakeEmailProvider],
})
export class FakeEmailProviderModule {}

export const providerModule = FakeEmailProviderModule;

/**
 * One fake client for a stored credential version (ADR 0058). The key is checked and then not used: the fake never
 * calls a network. Tests read what it accepted from the instance.
 */
export function createOutboundClient(secrets: { readonly api_key: string }): FakeEmailProvider {
  if (validateIntegrationSecret("api_key", secrets.api_key) !== undefined) {
    throw new Error("The stored outbound secret is not valid.");
  }
  return new FakeEmailProvider({ captureFile: parseFakeEmailCaptureFile(process.env) });
}

const FAKE_SECRET_PATTERNS: Readonly<Record<string, RegExp>> = {
  api_key: /^fake_[A-Za-z0-9]{8,64}$/,
  webhook_secret: /^fakewh_[A-Za-z0-9]{8,64}$/,
};

/**
 * The format rule of the fake's managed secrets (`fluxkit.secrets`, ADR 0058): test fixtures for the admin integration
 * store. The fake provider itself never reads them; the problem names the rule, never the value.
 */
export function validateIntegrationSecret(field: string, value: string): string | undefined {
  const pattern = FAKE_SECRET_PATTERNS[field];
  if (pattern === undefined) return "Unknown secret field.";
  return pattern.test(value)
    ? undefined
    : "Must be the fake prefix followed by 8 to 64 letters or digits (the value is not shown).";
}
