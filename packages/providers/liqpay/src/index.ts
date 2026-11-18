import { Logger, Module } from "@nestjs/common";
import { parseLiqPayEnv } from "./config.js";
import { LiqPayHttp } from "./http.js";
import {
  LIQPAY_CLOCK,
  LIQPAY_HTTP,
  LIQPAY_LOGGER,
  LiqPayPaymentProvider,
  type LiqPayClock,
  type LiqPayLogger,
} from "./liqpay-provider.js";

export {
  LIQPAY_API_ORIGIN,
  LIQPAY_CURRENCY,
  LIQPAY_PATHS,
  LIQPAY_VERSION,
  LiqPayConfigError,
  parseLiqPayEnv,
  type LiqPayConfig,
  type LiqPayPath,
  validateIntegrationSecret,
} from "./config.js";
export {
  failureOfExchange,
  malformedAnswer,
  mapLiqPayError,
  LIQPAY_ERROR_CODES,
  liqpayErrorCodeOf,
  type LiqPayErrorCode,
} from "./answer-map.js";
export {
  LIQPAY_MAX_ANSWER_BYTES,
  LiqPayHttp,
  type LiqPayAnswer,
  type LiqPayExchange,
  type LiqPayRequest,
} from "./http.js";
export {
  checkoutParamsOf,
  expiredDateOf,
  factOf,
  handoffFieldsOf,
  majorAmountOf,
  minorAmountOf,
  parseWebhookForm,
  readRefundStatus,
  validateCreateInput,
  type CheckoutParams,
  type CreateRefusal,
} from "./payload.js";
export { encodeData, signData, signatureOf, signatureValid } from "./signature.js";
export {
  LIQPAY_CAPABILITIES,
  LIQPAY_CLOCK,
  LIQPAY_HTTP,
  LIQPAY_LOGGER,
  LIQPAY_PROVIDER_CODE,
  LiqPayPaymentProvider,
  type LiqPayClock,
  type LiqPayLogger,
} from "./liqpay-provider.js";

@Module({
  providers: [
    {
      provide: LIQPAY_LOGGER,
      useFactory: (): LiqPayLogger => new Logger("LiqPay"),
    },
    {
      provide: LIQPAY_HTTP,
      useFactory: (): LiqPayHttp => {
        const config = parseLiqPayEnv(process.env);
        return new LiqPayHttp({
          publicKey: config.publicKey,
          privateKey: config.privateKey,
        });
      },
    },
    { provide: LIQPAY_CLOCK, useValue: ((): Date => new Date()) satisfies LiqPayClock },
    LiqPayPaymentProvider,
  ],
  exports: [LiqPayPaymentProvider],
})
export class LiqPayPaymentProviderModule {}

export const providerModule = LiqPayPaymentProviderModule;
