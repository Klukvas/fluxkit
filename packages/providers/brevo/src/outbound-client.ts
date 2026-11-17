import type { EmailProviderPort } from "@fluxkit/core";
import { validateIntegrationSecret } from "./config.js";
import { BrevoEmailProvider, type BrevoLogger } from "./brevo-provider.js";
import { BrevoHttp } from "./http.js";

const quiet: BrevoLogger = { warn() {} };

/**
 * One Brevo client for a stored credential version (ADR 0058). The key is the argument, never the process environment.
 * A value that fails the same format rule as a paste is refused before any request, and the error does not carry it.
 */
export function createOutboundClient(secrets: { readonly api_key: string }): EmailProviderPort {
  if (validateIntegrationSecret("api_key", secrets.api_key) !== undefined) {
    throw new Error("The stored outbound secret is not valid.");
  }
  return new BrevoEmailProvider(new BrevoHttp({ apiKey: secrets.api_key }), quiet);
}
