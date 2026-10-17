import { Module, type DynamicModule } from "@nestjs/common";
import type { AdminAuthenticator } from "./auth/admin-authenticator.js";
import { DEFAULT_ADMIN_AUTH_CONFIG, type AdminAuthConfig } from "./auth/auth-config.js";
import { AuthModule } from "./auth/auth.module.js";
import type { Clock } from "./auth/clock.js";
import type { ScryptParams } from "./auth/password-hasher.js";
import { CartModule } from "./cart/cart.module.js";
import { DEFAULT_CART_CONFIG, type CartConfig } from "./cart/cart-config.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { CustomerAuthModule } from "./customers/auth/customer-auth.module.js";
import {
  DEFAULT_CUSTOMER_AUTH_CONFIG,
  type CustomerAuthConfig,
} from "./customers/auth/customer-auth-config.js";
import { CustomersModule } from "./customers/customers.module.js";
import { CommonModule } from "./common/common.module.js";
import type { LocaleConfig } from "./common/locale.js";
import { DEFAULT_PRICING_CONFIG, type PricingConfig } from "./common/pricing-config.js";
import { DatabaseModule } from "./database/database.module.js";
import type { LoadedFeature } from "./features/feature-loader.js";
import { HealthModule } from "./health/health.module.js";
import { InventoryModule } from "./inventory/inventory.module.js";
import { DEFAULT_ORDERS_CONFIG, type OrdersConfig } from "./orders/orders-config.js";
import { OrdersModule } from "./orders/orders.module.js";
import { RateLimitModule } from "./rate-limit/rate-limit.module.js";
import type { RateLimitOverrides } from "./rate-limit/rate-limiter.js";

export interface AppModuleOptions {
  databaseUrl: string;
  features: LoadedFeature[];
  locale: LocaleConfig;
  /** Defaults to the defaults of `docs/contracts/config.md` (UAH, prices include tax, threshold 5). */
  pricing?: PricingConfig;
  /** Defaults to the secure defaults of `docs/contracts/config.md` (the seed command builds the module without them). */
  adminAuth?: AdminAuthConfig;
  /** Defaults to the secure defaults of `docs/contracts/config.md`. */
  customerAuth?: CustomerAuthConfig;
  /** Defaults to the defaults of `docs/contracts/config.md` (30 days). */
  cart?: CartConfig;
  /** Defaults to the defaults of `docs/contracts/config.md` (30 minutes to pay, 90 days of guest access). */
  orders?: OrdersConfig;
  /** Tests only: other numbers for the named rate limits (a concurrency spec places many orders from one address). */
  rateLimits?: RateLimitOverrides;
  /** Tests only: replaces the session-based authenticator. */
  adminAuthenticator?: AdminAuthenticator;
  /** Tests only: a controlled clock for session expiry. */
  clock?: Clock;
  /** Tests only: cheap scrypt parameters. */
  scrypt?: ScryptParams;
  /** Default true. Command-line tools pass false so they change nothing but their own target. */
  cleanExpiredSessionsOnBootstrap?: boolean;
}

@Module({})
export class AppModule {
  static register(options: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CommonModule.register(options.locale, options.pricing ?? DEFAULT_PRICING_CONFIG),
        DatabaseModule.forRoot(options.databaseUrl),
        AuthModule.register({
          config: options.adminAuth ?? DEFAULT_ADMIN_AUTH_CONFIG,
          authenticator: options.adminAuthenticator,
          clock: options.clock,
          scrypt: options.scrypt,
          cleanExpiredSessionsOnBootstrap: options.cleanExpiredSessionsOnBootstrap,
        }),
        RateLimitModule.register(options.rateLimits),
        CustomerAuthModule.register({
          config: options.customerAuth ?? DEFAULT_CUSTOMER_AUTH_CONFIG,
        }),
        HealthModule,
        CustomersModule,
        CatalogModule,
        InventoryModule,
        CartModule.register({ config: options.cart ?? DEFAULT_CART_CONFIG }),
        OrdersModule.register({ config: options.orders ?? DEFAULT_ORDERS_CONFIG }),
        ...options.features.map((feature) => feature.module),
      ],
    };
  }
}
