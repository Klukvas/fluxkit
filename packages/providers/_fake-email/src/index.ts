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
