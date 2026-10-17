import type { LogLevel } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from "@nestjs/swagger";
import { DEFAULT_LOCALE, DEFAULT_LOCALES, type AppEnv } from "@fluxkit/config";
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
import {
  DEFAULT_FEATURES_DIR,
  loadFeatures,
  type LoadedFeature,
} from "./features/feature-loader.js";

export type CreateAppEnv = Pick<AppEnv, "databaseUrl" | "enabledFeatures" | "featuresDir"> &
  Partial<
    Pick<
      AppEnv,
      | "defaultLocale"
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
      | "schedulerEnabled"
      | "schedulerIntervalSeconds"
      | "shopCurrency"
      | "pricesIncludeTax"
      | "lowStockThreshold"
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
  /** Default true. `pnpm jobs:run-once` passes false: it changes nothing but the data its jobs handle. */
  cleanExpiredSessionsOnBootstrap?: boolean;
  /** Default `["error", "warn", "log"]`. The command line passes `["error", "warn"]` and prints its own report. */
  logLevels?: LogLevel[];
}

export async function createApp(
  env: CreateAppEnv,
  options: CreateAppOptions = {},
): Promise<NestExpressApplication> {
  const features = await loadFeatures({
    enabled: env.enabledFeatures,
    featuresDir: env.featuresDir ?? DEFAULT_FEATURES_DIR,
  });
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register({
      databaseUrl: env.databaseUrl,
      features: [...features, ...(options.extraFeatures ?? [])],
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
      },
      // An environment-less caller (tests, the OpenAPI export) gets no timer; the API passes `SCHEDULER_ENABLED`.
      scheduler: {
        enabled: env.schedulerEnabled ?? DISABLED_SCHEDULER_CONFIG.enabled,
        intervalSeconds: env.schedulerIntervalSeconds ?? DISABLED_SCHEDULER_CONFIG.intervalSeconds,
      },
      rateLimits: options.rateLimits,
      adminAuthenticator: options.adminAuthenticator,
      clock: options.clock,
      scrypt: options.scrypt,
      cleanExpiredSessionsOnBootstrap: options.cleanExpiredSessionsOnBootstrap,
    }),
    { logger: options.logLevels ?? ["error", "warn", "log"] },
  );
  app.enableShutdownHooks();
  return app;
}

export function buildOpenApiDocument(app: NestExpressApplication): OpenAPIObject {
  const config = new DocumentBuilder().setTitle("Fluxkit API").setVersion("0.0.0").build();
  return SwaggerModule.createDocument(app, config);
}
