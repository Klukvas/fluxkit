import { Logger, Module } from "@nestjs/common";
import { parseBrevoEnv, readBrevoWebhookSecret } from "./config.js";
import { createBrevoWebhookVerifier } from "./webhook.js";
import type { EmailWebhookVerifier } from "@fluxkit/core";
import { BrevoHttp } from "./http.js";
import {
  BREVO_HTTP,
  BREVO_LOGGER,
  BREVO_WEBHOOK_VERIFIER,
  BrevoEmailProvider,
  type BrevoLogger,
} from "./brevo-provider.js";

export {
  parseBrevoEnv,
  readBrevoWebhookSecret,
  BREVO_API_ORIGIN,
  BREVO_SEND_PATH,
  BREVO_USER_AGENT,
  BrevoConfigError,
  type BrevoConfig,
  validateIntegrationSecret,
} from "./config.js";
export {
  mapBrevoAnswer,
  BREVO_ERROR_CODES,
  brevoErrorCodeOf,
  retryAfterSecondsOf,
  type BrevoErrorCode,
} from "./answer-map.js";
export {
  BREVO_MAX_ANSWER_BYTES,
  BREVO_SEND_URL,
  BrevoHttp,
  type BrevoAnswer,
  type BrevoExchange,
} from "./http.js";
export { brevoBodyOf, type BrevoEmailBody } from "./request.js";
export { BREVO_PROVIDER_CODE, BrevoEmailProvider, type BrevoLogger } from "./brevo-provider.js";
export { createBrevoWebhookVerifier } from "./webhook.js";

/**
 * Entry point read by the API's email provider loader (named export `providerModule`, ADR 0031 decision 4). Mounted only
 * when `EMAIL_PROVIDER=brevo`. Creating it reads `BREVO_API_KEY` (`parseBrevoEnv`): a missing or malformed key stops
 * the startup, loudly, without the value. Nothing is sent to Brevo at startup (the admin test requires a separate deliberate send).
 */
@Module({
  providers: [
    {
      provide: BREVO_LOGGER,
      useFactory: (): BrevoLogger => new Logger("Brevo"),
    },
    {
      provide: BREVO_HTTP,
      useFactory: (): BrevoHttp => new BrevoHttp({ apiKey: parseBrevoEnv(process.env).apiKey }),
    },
    {
      provide: BREVO_WEBHOOK_VERIFIER,
      useFactory: (): EmailWebhookVerifier | undefined => {
        const secret = readBrevoWebhookSecret(process.env);
        return secret === undefined ? undefined : createBrevoWebhookVerifier(secret);
      },
    },
    BrevoEmailProvider,
  ],
  exports: [BrevoEmailProvider],
})
export class BrevoEmailProviderModule {}

export const providerModule = BrevoEmailProviderModule;
