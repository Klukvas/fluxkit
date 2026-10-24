import type { LogLevel } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from "@nestjs/swagger";
import { DEFAULT_LOCALE, DEFAULT_LOCALES, DEFAULT_TRUST_PROXY, type AppEnv } from "@fluxkit/config";
import { AppModule } from "./app.module.js";
import type { AdminAuthenticator } from "./auth/admin-authenticator.js";
import { DEFAULT_ADMIN_AUTH_CONFIG } from "./auth/auth-config.js";
import type { Clock } from "./auth/clock.js";
import { DEFAULT_CART_CONFIG } from "./cart/cart-config.js";
import { DEFAULT_ORDERS_CONFIG } from "./orders/orders-config.js";
import { DISABLED_SCHEDULER_CONFIG } from "./jobs/scheduler-config.js";
import { DEFAULT_CUSTOMER_AUTH_CONFIG } from "./customers/auth/customer-auth-config.js";
import type { ScryptParams } from "./auth/password-hasher.js";
import type { RateLimitOverrides } from "./rate-limit/rate-limiter.js";
import { DEFAULT_PRICING_CONFIG, toPricingConfig } from "./common/pricing-config.js";
import { documentAdminPermissions } from "./auth/admin-permission-docs.js";
import { documentAdminCsrf, documentStoreContract } from "./common/openapi.js";
import {
  DEFAULT_MEDIA_TUNING,
  DISABLED_MEDIA_CONFIG,
  type MediaConfig,
  type MediaTuning,
} from "./media/media-config.js";
import {
  DEFAULT_FEATURES_DIR,
  loadFeatures,
  type LoadedFeature,
} from "./features/feature-loader.js";
import {
  DEFAULT_SHIPPING_PROVIDERS_DIR,
  loadShippingProviders,
  type LoadedShippingProvider,
  type ShipmentCallTimeouts,
} from "./shipping/registry/index.js";

export type CreateAppEnv = Pick<AppEnv, "databaseUrl" | "enabledFeatures" | "featuresDir"> &
  Partial<
    Pick<
      AppEnv,
      | "defaultLocale"
      | "enabledShippingProviders"
      | "locales"
      | "adminCookieSecure"
      | "adminSessionIdleMinutes"
      | "adminSessionMaxHours"
      | "storeCookieSecure"
      | "customerSessionIdleMinutes"
      | "customerSessionMaxHours"
      | "cartTtlDays"
      | "orderPaymentTtlMinutes"
      | "orderGuestAccessDays"
      | "orderTokenSecret"
      | "maxOpenOrders"
      | "trustProxy"
      | "schedulerEnabled"
      | "schedulerIntervalSeconds"
      | "shopCurrency"
      | "pricesIncludeTax"
      | "lowStockThreshold"
      | "mediaStorageDriver"
      | "mediaDir"
      | "mediaPublicBaseUrl"
      | "mediaMaxBytes"
      | "mediaMaxPixels"
    >
  >;

export interface CreateAppOptions {
  /** Tests only. Without it admin requests are authenticated by the session cookie (`SessionAdminAuthenticator`). */
  adminAuthenticator?: AdminAuthenticator;
  /** Tests only: other numbers for the named rate limits. */
  rateLimits?: RateLimitOverrides;
  /** Tests only: a controlled clock for session expiry. */
  clock?: Clock;
  /** Tests only: cheap scrypt parameters. */
  scrypt?: ScryptParams;
  /** Tests only: extra modules loaded as if they were enabled features (for example a probe controller). */
  extraFeatures?: LoadedFeature[];
  /** Tests only: shipping provider modules mounted as if they were enabled (no package on disk is read for them). */
  extraShippingProviders?: LoadedShippingProvider[];
  /** Tests only: shorter limits for the shipment provider calls (production uses the core waybill limit). */
  shipmentCallTimeouts?: Partial<ShipmentCallTimeouts>;
  /** Tests only: where provider packages are looked up (default `<repo>/packages/providers`). */
  shippingProvidersDir?: string;
  /** Default true. `pnpm jobs:run-once` passes false: it changes nothing but the data its jobs handle. */
  cleanExpiredSessionsOnBootstrap?: boolean;
  /** Default `["error", "warn", "log"]`. The command line passes `["error", "warn"]` and prints its own report. */
  logLevels?: LogLevel[];
  /** Tests only: other processing slots, waits and budgets of the media upload (ADR 0028 decision 3). */
  mediaTuning?: Partial<MediaTuning>;
}

/**
 * The media configuration of an environment. A caller without `MEDIA_STORAGE_DRIVER` (tests, the OpenAPI export, the
 * commands) gets uploads switched off and needs no directory; the API passes the values of `loadEnv`.
 */
function mediaConfigOf(env: CreateAppEnv, tuning: Partial<MediaTuning> = {}): MediaConfig {
  if (env.mediaStorageDriver === undefined) {
    return DISABLED_MEDIA_CONFIG;
  }
  return {
    driver: env.mediaStorageDriver,
    directory: env.mediaDir,
    publicBaseUrl: env.mediaPublicBaseUrl,
    maxBytes: env.mediaMaxBytes ?? DISABLED_MEDIA_CONFIG.maxBytes,
    maxPixels: env.mediaMaxPixels ?? DISABLED_MEDIA_CONFIG.maxPixels,
    tuning: { ...DEFAULT_MEDIA_TUNING, ...tuning },
  };
}

export async function createApp(
  env: CreateAppEnv,
  options: CreateAppOptions = {},
): Promise<NestExpressApplication> {
  const features = await loadFeatures({
    enabled: env.enabledFeatures,
    featuresDir: env.featuresDir ?? DEFAULT_FEATURES_DIR,
  });
  const shippingProviders = await loadShippingProviders({
    enabled: env.enabledShippingProviders ?? [],
    providersDir: options.shippingProvidersDir ?? DEFAULT_SHIPPING_PROVIDERS_DIR,
  });
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register({
      databaseUrl: env.databaseUrl,
      features: [...features, ...(options.extraFeatures ?? [])],
      shippingProviders: [...shippingProviders, ...(options.extraShippingProviders ?? [])],
      locale: {
        defaultLocale: env.defaultLocale ?? DEFAULT_LOCALE,
        locales: env.locales ?? DEFAULT_LOCALES,
      },
      pricing: toPricingConfig({
        shopCurrency: env.shopCurrency ?? DEFAULT_PRICING_CONFIG.shopCurrency,
        pricesIncludeTax: env.pricesIncludeTax ?? DEFAULT_PRICING_CONFIG.pricesIncludeTax,
        lowStockThreshold: env.lowStockThreshold ?? DEFAULT_PRICING_CONFIG.lowStockThreshold,
      }),
      adminAuth: {
        cookieSecure: env.adminCookieSecure ?? DEFAULT_ADMIN_AUTH_CONFIG.cookieSecure,
        idleMinutes: env.adminSessionIdleMinutes ?? DEFAULT_ADMIN_AUTH_CONFIG.idleMinutes,
        maxHours: env.adminSessionMaxHours ?? DEFAULT_ADMIN_AUTH_CONFIG.maxHours,
      },
      customerAuth: {
        cookieSecure: env.storeCookieSecure ?? DEFAULT_CUSTOMER_AUTH_CONFIG.cookieSecure,
        idleMinutes: env.customerSessionIdleMinutes ?? DEFAULT_CUSTOMER_AUTH_CONFIG.idleMinutes,
        maxHours: env.customerSessionMaxHours ?? DEFAULT_CUSTOMER_AUTH_CONFIG.maxHours,
      },
      cart: { ttlDays: env.cartTtlDays ?? DEFAULT_CART_CONFIG.ttlDays },
      orders: {
        paymentTtlMinutes: env.orderPaymentTtlMinutes ?? DEFAULT_ORDERS_CONFIG.paymentTtlMinutes,
        guestAccessDays: env.orderGuestAccessDays ?? DEFAULT_ORDERS_CONFIG.guestAccessDays,
        maxOpenOrders: env.maxOpenOrders ?? DEFAULT_ORDERS_CONFIG.maxOpenOrders,
        tokenSecret: env.orderTokenSecret,
      },
      // An environment-less caller (tests, the OpenAPI export) gets no timer; the API passes `SCHEDULER_ENABLED`.
      scheduler: {
        enabled: env.schedulerEnabled ?? DISABLED_SCHEDULER_CONFIG.enabled,
        intervalSeconds: env.schedulerIntervalSeconds ?? DISABLED_SCHEDULER_CONFIG.intervalSeconds,
      },
      media: mediaConfigOf(env, options.mediaTuning),
      rateLimits: options.rateLimits,
      shipmentCallTimeouts: options.shipmentCallTimeouts,
      adminAuthenticator: options.adminAuthenticator,
      clock: options.clock,
      scrypt: options.scrypt,
      cleanExpiredSessionsOnBootstrap: options.cleanExpiredSessionsOnBootstrap,
    }),
    { logger: options.logLevels ?? ["error", "warn", "log"] },
  );
  // The one place Express is configured, so the API, the specs and the OpenAPI export all see the same `request.ip`.
  // 0 (the default) trusts no proxy: the client is the socket address and `X-Forwarded-For` is ignored.
  app.set("trust proxy", env.trustProxy ?? DEFAULT_TRUST_PROXY);
  app.enableShutdownHooks();
  return app;
}

export function buildOpenApiDocument(app: NestExpressApplication): OpenAPIObject {
  const config = new DocumentBuilder().setTitle("Fluxkit API").setVersion("0.0.0").build();
  const document = documentStoreContract(SwaggerModule.createDocument(app, config));
  documentAdminCsrf(document);
  return documentAdminPermissions(app, document);
}
