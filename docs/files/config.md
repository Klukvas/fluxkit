# packages/config

- `src/env.ts` - `loadEnv`: validates process env with zod and returns typed `AppEnv` (locales, admin session limits, `ORDER_PAYMENT_TTL_MINUTES` and `ORDER_GUEST_ACCESS_DAYS`, `SHOP_CURRENCY`, `PRICES_INCLUDE_TAX`, `LOW_STOCK_THRESHOLD`). Repeats the supported currency codes of `@fluxkit/core` (this package does not depend on core; a test in `apps/api` asserts the lists are equal) and the defaults of the session and pricing variables.
- `src/features.ts` - `parseEnabledFeatures`: parses and validates `FEATURES_ENABLED`.
- `src/config.spec.ts` - unit tests.
