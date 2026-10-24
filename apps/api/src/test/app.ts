import type { NestExpressApplication } from "@nestjs/platform-express";
import type { AdminRole } from "@fluxkit/core";
import { createApp } from "../app.factory.js";
import type { AdminAuthenticator } from "../auth/admin-authenticator.js";
import type { Clock } from "../auth/clock.js";
import type { LoadedFeature } from "../features/feature-loader.js";
import type { MediaTuning } from "../media/media-config.js";
import type { RateLimitOverrides } from "../rate-limit/rate-limiter.js";
import { AllowAllAdminAuthenticator } from "./allow-all-admin-authenticator.js";
import { requireEnv } from "./env.js";

export interface RunningApp {
  app: NestExpressApplication;
  baseUrl: string;
}

/** Cheap scrypt parameters: the suite hashes many passwords. The default ones are exercised in password-hasher.spec. */
export const TEST_SCRYPT_PARAMS = { N: 16, r: 8, p: 1 } as const;

/** A throwaway order token secret for specs (32 characters or more, as `ORDER_TOKEN_SECRET` requires). */
export const TEST_ORDER_TOKEN_SECRET = "test-order-token-secret-0123456789-abcdef";

/** The open-order limit of specs that do not test it: out of reach, so they can place as many orders as they like. */
export const TEST_MAX_OPEN_ORDERS = 1_000_000;

export interface StartAppOptions {
  enabledFeatures?: string[];
  featuresDir?: string;
  /**
   * Test authenticator for `/admin`. Defaults to one that signs every request in as an OWNER (see `adminPrincipal`
   * for other roles). Pass `"production-default"` to run with the real session authenticator.
   */
  adminAuthenticator?: AdminAuthenticator | "production-default";
  /** Starts the default test authenticator as another role, for permission matrix tests. */
  adminPrincipal?: { role: AdminRole };
  /** Other numbers for the named rate limits (default: the production ones). */
  rateLimits?: RateLimitOverrides;
  /** A controlled clock for session expiry (use with `"production-default"`). */
  clock?: Clock;
  /** `SHIPPING_PROVIDERS_ENABLED`: provider packages the loader imports, for example `["fake"]` (build first; the fake is test-only). */
  enabledShippingProviders?: string[];
  /** Extra modules loaded like enabled features, for probe controllers. */
  extraFeatures?: LoadedFeature[];
  adminCookieSecure?: boolean;
  adminSessionIdleMinutes?: number;
  adminSessionMaxHours?: number;
  storeCookieSecure?: boolean;
  customerSessionIdleMinutes?: number;
  customerSessionMaxHours?: number;
  /** `CART_TTL_DAYS`; defaults to 30. */
  cartTtlDays?: number;
  /** `ORDER_PAYMENT_TTL_MINUTES`; defaults to 30. */
  orderPaymentTtlMinutes?: number;
  /** `ORDER_GUEST_ACCESS_DAYS`; defaults to 90. */
  orderGuestAccessDays?: number;
  /**
   * `MAX_OPEN_ORDERS`; defaults to a huge number here, NOT to 3: many specs place more than 3 orders for one email in one
   * app. The specs of the limit itself (`checkout-open-orders.spec.ts`) pass the number they test.
   */
  maxOpenOrders?: number;
  /** `ORDER_TOKEN_SECRET`; defaults to `TEST_ORDER_TOKEN_SECRET`. */
  orderTokenSecret?: string;
  /** `TRUST_PROXY`, the number of trusted proxy hops; defaults to 0 (off). */
  trustProxy?: number;
  /** `SCHEDULER_ENABLED`; defaults to FALSE here so a spec stays deterministic (jobs are called directly). */
  schedulerEnabled?: boolean;
  /** `SCHEDULER_INTERVAL_SECONDS`; defaults to 60. */
  schedulerIntervalSeconds?: number;
  /** `SHOP_CURRENCY`; defaults to UAH. */
  shopCurrency?: string;
  /** `LOW_STOCK_THRESHOLD`; defaults to 5. */
  lowStockThreshold?: number;
  /** `PRICES_INCLUDE_TAX`; defaults to true. */
  pricesIncludeTax?: boolean;
  /** `DEFAULT_LOCALE`; defaults to `uk`. Must be one of `locales`. */
  defaultLocale?: string;
  /** `LOCALES`; defaults to `uk`, `en`. */
  locales?: string[];
  /** `MEDIA_STORAGE_DRIVER`; without it uploads are switched off (see `startMediaApp` in media-app.ts). */
  mediaStorageDriver?: "local" | "none";
  mediaDir?: string;
  mediaPublicBaseUrl?: string;
  mediaMaxBytes?: number;
  mediaMaxPixels?: number;
  /** Other processing slots, waits and budgets of the media upload. */
  mediaTuning?: Partial<MediaTuning>;
}

export async function startApp(options: StartAppOptions = {}): Promise<RunningApp> {
  const authenticator =
    options.adminAuthenticator ?? new AllowAllAdminAuthenticator(options.adminPrincipal?.role);
  const app = await createApp(
    {
      databaseUrl: requireEnv("DATABASE_URL"),
      enabledFeatures: options.enabledFeatures ?? [],
      enabledShippingProviders: options.enabledShippingProviders,
      featuresDir: options.featuresDir,
      adminCookieSecure: options.adminCookieSecure,
      adminSessionIdleMinutes: options.adminSessionIdleMinutes,
      adminSessionMaxHours: options.adminSessionMaxHours,
      storeCookieSecure: options.storeCookieSecure,
      customerSessionIdleMinutes: options.customerSessionIdleMinutes,
      customerSessionMaxHours: options.customerSessionMaxHours,
      cartTtlDays: options.cartTtlDays,
      orderPaymentTtlMinutes: options.orderPaymentTtlMinutes,
      orderGuestAccessDays: options.orderGuestAccessDays,
      orderTokenSecret: options.orderTokenSecret ?? TEST_ORDER_TOKEN_SECRET,
      maxOpenOrders: options.maxOpenOrders ?? TEST_MAX_OPEN_ORDERS,
      trustProxy: options.trustProxy,
      schedulerEnabled: options.schedulerEnabled ?? false,
      schedulerIntervalSeconds: options.schedulerIntervalSeconds,
      shopCurrency: options.shopCurrency,
      lowStockThreshold: options.lowStockThreshold,
      pricesIncludeTax: options.pricesIncludeTax,
      defaultLocale: options.defaultLocale,
      locales: options.locales,
      mediaStorageDriver: options.mediaStorageDriver,
      mediaDir: options.mediaDir,
      mediaPublicBaseUrl: options.mediaPublicBaseUrl,
      mediaMaxBytes: options.mediaMaxBytes,
      mediaMaxPixels: options.mediaMaxPixels,
    },
    {
      adminAuthenticator: authenticator === "production-default" ? undefined : authenticator,
      rateLimits: options.rateLimits,
      clock: options.clock,
      scrypt: TEST_SCRYPT_PARAMS,
      extraFeatures: options.extraFeatures,
      mediaTuning: options.mediaTuning,
    },
  );
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as { port: number };
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}
