import { Logger, Module } from "@nestjs/common";
import { parseResendEnv } from "./config.js";
import { ResendHttp } from "./http.js";
import {
  RESEND_HTTP,
  RESEND_LOGGER,
  ResendEmailProvider,
  type ResendLogger,
} from "./resend-provider.js";

export {
  parseResendEnv,
  RESEND_API_ORIGIN,
  RESEND_SEND_PATH,
  RESEND_USER_AGENT,
  ResendConfigError,
  type ResendConfig,
} from "./config.js";
export {
  mapResendAnswer,
  RESEND_ERROR_NAMES,
  resendErrorNameOf,
  retryAfterSecondsOf,
  type ResendErrorName,
} from "./answer-map.js";
export {
  RESEND_MAX_ANSWER_BYTES,
  RESEND_SEND_URL,
  ResendHttp,
  type ResendAnswer,
  type ResendExchange,
} from "./http.js";
export { RESEND_CATEGORY_TAG, resendBodyOf, type ResendEmailBody } from "./request.js";
export { RESEND_PROVIDER_CODE, ResendEmailProvider, type ResendLogger } from "./resend-provider.js";

/**
 * Entry point read by the API's email provider loader (named export `providerModule`, ADR 0031 decision 4). Mounted only
 * when `EMAIL_PROVIDER=resend`. Creating it reads `RESEND_API_KEY` (`parseResendEnv`): a missing or malformed key stops
 * the startup, loudly, without the value. Nothing is sent to Resend at startup (a sending-only key cannot call any other
 * route, R8 `restricted_api_key`; the admin test is a real send).
 */
@Module({
  providers: [
    {
      provide: RESEND_LOGGER,
      useFactory: (): ResendLogger => new Logger("Resend"),
    },
    {
      provide: RESEND_HTTP,
      useFactory: (): ResendHttp => new ResendHttp({ apiKey: parseResendEnv(process.env).apiKey }),
    },
    ResendEmailProvider,
  ],
  exports: [ResendEmailProvider],
})
export class ResendEmailProviderModule {}

export const providerModule = ResendEmailProviderModule;
