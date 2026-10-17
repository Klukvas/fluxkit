import type { NestExpressApplication } from "@nestjs/platform-express";
import type { AdminRole } from "@fluxkit/core";
import { createApp } from "../app.factory.js";
import type { AdminAuthenticator } from "../auth/admin-authenticator.js";
import type { Clock } from "../auth/clock.js";
import type { LoadedFeature } from "../features/feature-loader.js";
import type { RateLimitOverrides } from "../rate-limit/rate-limiter.js";
import { AllowAllAdminAuthenticator } from "./allow-all-admin-authenticator.js";
import { requireEnv } from "./env.js";

export interface RunningApp {
  app: NestExpressApplication;
  baseUrl: string;
}

/** Cheap scrypt parameters: the suite hashes many passwords. The default ones are exercised in password-hasher.spec. */
export const TEST_SCRYPT_PARAMS = { N: 16, r: 8, p: 1 } as const;

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
  /** `SHOP_CURRENCY`; defaults to UAH. */
  shopCurrency?: string;
  /** `LOW_STOCK_THRESHOLD`; defaults to 5. */
  lowStockThreshold?: number;
  /** `PRICES_INCLUDE_TAX`; defaults to true. */
  pricesIncludeTax?: boolean;
}

export async function startApp(options: StartAppOptions = {}): Promise<RunningApp> {
  const authenticator =
    options.adminAuthenticator ?? new AllowAllAdminAuthenticator(options.adminPrincipal?.role);
  const app = await createApp(
    {
      databaseUrl: requireEnv("DATABASE_URL"),
      enabledFeatures: options.enabledFeatures ?? [],
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
      shopCurrency: options.shopCurrency,
      lowStockThreshold: options.lowStockThreshold,
      pricesIncludeTax: options.pricesIncludeTax,
    },
    {
      adminAuthenticator: authenticator === "production-default" ? undefined : authenticator,
      rateLimits: options.rateLimits,
      clock: options.clock,
      scrypt: TEST_SCRYPT_PARAMS,
      extraFeatures: options.extraFeatures,
    },
  );
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as { port: number };
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}
