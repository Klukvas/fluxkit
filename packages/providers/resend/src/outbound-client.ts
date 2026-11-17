import type { EmailProviderPort } from "@fluxkit/core";
import { validateIntegrationSecret } from "./config.js";
import { ResendHttp } from "./http.js";
import { ResendEmailProvider, type ResendLogger } from "./resend-provider.js";

const quiet: ResendLogger = { warn() {} };

/**
 * One Resend client for a stored credential version (ADR 0058). The key is the argument, never the process environment.
 * A value that fails the same format rule as a paste is refused before any request, and the error does not carry it.
 */
export function createOutboundClient(secrets: { readonly api_key: string }): EmailProviderPort {
  if (validateIntegrationSecret("api_key", secrets.api_key) !== undefined) {
    throw new Error("The stored outbound secret is not valid.");
  }
  return new ResendEmailProvider(new ResendHttp({ apiKey: secrets.api_key }), quiet);
}
