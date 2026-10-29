import { Logger, Module } from "@nestjs/common";
import { parseMonobankEnv } from "./config.js";
import { MonobankHttp } from "./http.js";
import {
  MONOBANK_CLOCK,
  MONOBANK_HTTP,
  MONOBANK_LOGGER,
  MonobankPaymentProvider,
  type MonobankClock,
  type MonobankLogger,
} from "./monobank-provider.js";

export {
  MONOBANK_API_ORIGIN,
  MONOBANK_PATHS,
  MONOBANK_TOKEN_HEADER,
  MonobankConfigError,
  parseMonobankEnv,
  type MonobankConfig,
  type MonobankPath,
} from "./config.js";
export {
  failureOfExchange,
  malformedAnswer,
  mapMonobankError,
  MONOBANK_ERROR_CODES,
  monobankErrorCodeOf,
  retryAfterSecondsOf,
  type MonobankErrorCode,
} from "./answer-map.js";
export {
  MONOBANK_MAX_ANSWER_BYTES,
  MonobankHttp,
  type MonobankAnswer,
  type MonobankExchange,
  type MonobankRequest,
} from "./http.js";
export {
  basketOrderOf,
  createBodyOf,
  factOf,
  isAllowedPageUrl,
  MONOBANK_CURRENCY,
  MONOBANK_CURRENCY_NUMBERS,
  MONOBANK_MAX_VALIDITY_SECONDS,
  MONOBANK_PAGE_HOSTS,
  readCancelAnswer,
  readCreateAnswer,
  type MonobankBasketItem,
  type MonobankCreateBody,
} from "./invoice.js";
export {
  KEY_REFETCH_INTERVAL_MS,
  MONOBANK_SIGNATURE_HEADER,
  MonobankKeyCache,
  publicKeyOf,
  signatureOf,
  signatureVerifies,
} from "./signature.js";
export {
  MONOBANK_CAPABILITIES,
  MONOBANK_CLOCK,
  MONOBANK_HTTP,
  MONOBANK_LOGGER,
  MONOBANK_PROVIDER_CODE,
  MonobankPaymentProvider,
  type MonobankClock,
  type MonobankLogger,
} from "./monobank-provider.js";

/**
 * Entry point read by the API's payment provider loader (named export `providerModule`, ADR 0032 decision 3). Mounted
 * only when `PAYMENT_PROVIDERS_ENABLED` names `monobank`. Creating it reads `MONOBANK_TOKEN` (`parseMonobankEnv`): a
 * missing or malformed token stops the startup, loudly, without the value. Nothing is sent to Monobank at startup: the
 * webhook key is fetched on the first webhook.
 */
@Module({
  providers: [
    {
      provide: MONOBANK_LOGGER,
      useFactory: (): MonobankLogger => new Logger("Monobank"),
    },
    {
      provide: MONOBANK_HTTP,
      useFactory: (): MonobankHttp =>
        new MonobankHttp({ token: parseMonobankEnv(process.env).token }),
    },
    { provide: MONOBANK_CLOCK, useValue: ((): Date => new Date()) satisfies MonobankClock },
    MonobankPaymentProvider,
  ],
  exports: [MonobankPaymentProvider],
})
export class MonobankPaymentProviderModule {}

export const providerModule = MonobankPaymentProviderModule;
