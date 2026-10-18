# packages/config

- `src/env.ts` - `loadEnv`: validates process env with zod and returns typed `AppEnv` (locales, admin session limits, the customer session limits and `STORE_COOKIE_SECURE`, `CART_TTL_DAYS`, `ORDER_PAYMENT_TTL_MINUTES` and `ORDER_GUEST_ACCESS_DAYS`, `ORDER_TOKEN_SECRET` (at least 32 characters, required when `NODE_ENV=production`, no default; never put it in an error message), `SCHEDULER_ENABLED` and `SCHEDULER_INTERVAL_SECONDS`, `SHOP_CURRENCY`, `PRICES_INCLUDE_TAX`, `LOW_STOCK_THRESHOLD`). Repeats the supported currency codes of `@fluxkit/core` (this package does not depend on core; a test in `apps/api` asserts the lists are equal) and the defaults of the session and pricing variables.
- `src/features.ts` - `parseEnabledFeatures`: parses and validates `FEATURES_ENABLED`.
- `src/config.spec.ts` - unit tests.
