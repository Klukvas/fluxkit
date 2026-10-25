import { Logger, Module } from "@nestjs/common";
import { parseNovaPostEnv } from "./config.js";
import { NovaPostHttp, type NovaPostLogger } from "./http.js";
import {
  NOVA_POST_HTTP,
  NOVA_POST_LOGGER,
  NovaPostShippingProvider,
} from "./nova-post-provider.js";

export {
  NOVA_POST_BASE_URLS,
  NOVA_POST_ENVIRONMENTS,
  NovaPostConfigError,
  parseNovaPostEnv,
  type NovaPostConfig,
  type NovaPostEnvironment,
} from "./config.js";
export { NovaPostCallError, NovaPostHttp, type NovaPostLogger } from "./http.js";
export {
  NOVA_POST_PROVIDER_CODE,
  NovaPostShippingProvider,
  novaPostPhone,
} from "./nova-post-provider.js";
export { mapNovaPostStatus, NOVA_POST_STATUS_TABLE } from "./status-map.js";
export {
  novaPostSettingsIssues,
  novaPostSettingsSchema,
  type NovaPostSettings,
} from "./settings.js";

/**
 * Entry point read by the API's shipping provider loader (named export `providerModule`, ADR 0029 decision 8). Mounted
 * only when SHIPPING_PROVIDERS_ENABLED contains "nova_post". Creating it reads NOVA_POST_API_KEY and NOVA_POST_ENVIRONMENT
 * (`parseNovaPostEnv`): a missing or malformed value stops the startup, loudly, without the value. Nothing is sent to Nova
 * Post at startup; the JWT is fetched on the first call.
 */
@Module({
  providers: [
    {
      provide: NOVA_POST_LOGGER,
      useFactory: (): NovaPostLogger => new Logger("NovaPost"),
    },
    {
      provide: NOVA_POST_HTTP,
      inject: [NOVA_POST_LOGGER],
      useFactory: (logger: NovaPostLogger): NovaPostHttp => {
        const config = parseNovaPostEnv(process.env);
        logger.log(`Nova Post environment: ${config.environment}`);
        return new NovaPostHttp({ baseUrl: config.baseUrl, apiKey: config.apiKey, logger });
      },
    },
    NovaPostShippingProvider,
  ],
  exports: [NovaPostShippingProvider],
})
export class NovaPostShippingProviderModule {}

export const providerModule = NovaPostShippingProviderModule;
