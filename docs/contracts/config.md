# Contract: configuration and feature flags

Status: draft (first version, introduced in plan step 5). Covered by SemVer (AGENTS.md section 17).

## Environment variables read by `apps/api` (validated by `@fluxkit/config` `loadEnv`)
| Variable | Required | Default | Meaning |
|---|---|---|---|
| `DATABASE_URL` | yes | - | Postgres connection string |
| `REDIS_URL` | no | - | Redis connection string (queues, cache) |
| `PORT` | no | 3000 | HTTP port |
| `FEATURES_ENABLED` | no | empty | Comma-separated optional feature names; unset means none |
| `FEATURES_DIR` | no | `<repo>/packages/features` | Where feature packages are discovered |
| `DEFAULT_LOCALE` | no | `uk` | Locale every translated text must contain; must be in `LOCALES` |
| `LOCALES` | no | `uk,en` | Comma-separated locales accepted in translated texts; lowercase codes (2 to 8 letters, optional `-` segments), no duplicates |
| `ADMIN_COOKIE_SECURE` | no | `true` | `Secure` flag of the admin session cookie. Exactly `true` or `false` (anything else, including an empty value, fails startup); `false` only for local plain-HTTP development |
| `ADMIN_SESSION_IDLE_MINUTES` | no | `720` | Admin session ends after this many idle minutes. Positive whole number, at most 525 600 (one year) |
| `ADMIN_SESSION_MAX_HOURS` | no | `168` | Absolute admin session lifetime in hours, even when used continuously. Positive whole number, at most 8 760 (one year) |
| `STORE_COOKIE_SECURE` | no | `true` | `Secure` flag of the customer session cookie (`fluxkit_customer_session`). Exactly `true` or `false` (anything else, including an empty value, fails startup); `false` only for local plain-HTTP development. Independent of `ADMIN_COOKIE_SECURE` |
| `CUSTOMER_SESSION_IDLE_MINUTES` | no | `43200` | Customer session ends after this many idle minutes (30 days). Positive whole number, digits only, at most 525 600 (one year) |
| `CUSTOMER_SESSION_MAX_HOURS` | no | `2160` | Absolute customer session lifetime in hours (90 days), even when used continuously. Positive whole number, digits only, at most 8 760 (one year) |
| `CART_TTL_DAYS` | no | `30` | A cart expires this many days after its last change (a customer cart too), and the guest cart cookie `fluxkit_cart` has the same `Max-Age`. Positive whole number, digits only, from 1 to 365. Its `Secure` flag follows `STORE_COOKIE_SECURE` |
| `ORDER_PAYMENT_TTL_MINUTES` | no | `30` | An order waits this many minutes for payment before it expires and gives its reserved stock back; the reservations outlive the order by a fixed 10 minutes. Whole number from 5 to 1440, digits only |
| `ORDER_GUEST_ACCESS_DAYS` | no | `90` | A guest can open their order with its access token for this many days after the token was issued (a replay of the checkout renews the window). Whole number from 1 to 3650, digits only |
| `ORDER_TOKEN_SECRET` | yes (API start; `loadEnv` also in production) | none | Secret the guest order access tokens are derived from (HMAC-SHA256 over the order id and the checkout `Idempotency-Key`, ADR 0023), so a repeated checkout request gets the same token. At least 32 characters, no default, used exactly as given (no trimming); a shorter value, including an empty one, fails startup. Required whenever `NODE_ENV` is `production` (for every command that reads the environment) and by the API process in every environment. Generate with `openssl rand -base64 48`; never commit or log it. Changing it does not break tokens already handed out; the next replay of an old checkout derives a token under the new secret and the earlier one stops working (ADR 0023, operational note) |
| `MAX_OPEN_ORDERS` | no | `3` | Unpaid (`awaiting_payment`) orders one customer, or one guest email (normalized, orders without a customer), may hold at once (ADR 0024). The checkout of one more is refused with `409 too_many_open_orders`; a paid, cancelled, expired or fulfilled order no longer counts; a replay of an existing checkout is answered even at the limit. Whole number from 1 to 50, digits only. It limits an email and a customer, not an IP address |
| `TRUST_PROXY` | no | `0` | Number of reverse-proxy hops in front of the API, the value of Express `trust proxy` (ADR 0024). `0` trusts none: the client is the connecting address and `X-Forwarded-For` is ignored. `n` trusts the last `n` addresses of the chain, so `request.ip` is the client the outermost trusted proxy saw. The store rate limits and the admin login limit count per `request.ip`. Whole number from 0 to 10, digits only. Set the EXACT number of hops: too high lets a client choose its own address with `X-Forwarded-For` and dodge the limits, too low keeps every shopper in the proxy's window |
| `SCHEDULER_ENABLED` | no | `true` | Whether this API process runs the scheduler (order expiry, reservation sweep, domain event delivery, cart and customer session cleanup). Exactly `true` or `false` (anything else, including an empty value, fails startup). With `false` nothing expires unless `pnpm jobs:run-once` runs (a cron): unpaid orders keep their stock reserved. `docs/api/jobs.md` |
| `SCHEDULER_INTERVAL_SECONDS` | no | `60` | Seconds between scheduler ticks. Whole number from 10 to 3600, digits only. Only one API instance works per tick (a Postgres advisory lock), so several instances do not multiply the work |
| `SHOP_CURRENCY` | no | `UAH` | The one currency the shop sells in. Exactly one of `UAH`, `USD`, `EUR`, `PLN`, `GBP`, `CZK`, `CHF`, `CAD`, `JPY`, `KWD` (upper case, the table of `@fluxkit/core`); anything else, including a lower-case code or an empty value, fails startup. An active variant needs a price in this currency to be published or switched on; prices in other currencies may be stored but are never sold or converted. **Changing it after data exists** hides every live product that has no price in the new currency: the store lists nothing for it (a list without it, a detail answering 404) while the product stays `active` in the admin. Price the variants in the new currency first (`PUT /admin/products/{id}/prices`, up to 500 prices per call), then change the setting. `pnpm seed` does not help: it never prices or stocks products that already exist |
| `PRICES_INCLUDE_TAX` | no | `true` | Whether stored prices already include tax. Exactly `true` or `false`. Only a flag for the storefront: no tax is calculated |
| `LOW_STOCK_THRESHOLD` | no | `5` | Available quantity at or below which (and above 0) a tracked variant is `low_stock`. Whole number from 0 to 1 000 000 000, digits only. Read by the API and used by the store API (`availability`: `low_stock` from 1 up to and including this threshold) |

Invalid values fail startup with a readable `Invalid environment: ...` error.

`pnpm db:migrate` reads only `DATABASE_URL` (through `loadEnv`, like the other commands; no default, a missing value fails with exit code 1) and takes no arguments. It applies the migrations of `apps/api/drizzle/` forward only and never rolls back (rollbacks are the manual `drizzle/NNNN_name.down.sql` scripts). Details: `README.md` (Database migrations).

`pnpm jobs:run-once` reads the same file and variables through `loadEnv` (a malformed value fails it with exit code 1, like the API), takes no arguments, builds the application WITHOUT the timer (it ignores `SCHEDULER_ENABLED`) and runs every scheduler job once under the same advisory lock. Exit codes `0` (ran), `1` (a job failed or bad input), `2` (the lock is held by a running scheduler: nothing was run). Details: `docs/api/jobs.md`.

`pnpm admin:create` reads the same file and `DATABASE_URL` (and the locale variables) through `loadEnv`, plus one variable that only that command reads: `ADMIN_PASSWORD`, the password of the user to create (12 to 128 characters). It is not a setting of the API and is deliberately absent from `.env.example`: pass it for one command (`ADMIN_PASSWORD=... pnpm admin:create --email ...`) or type the password at the prompt instead; do not store it in `.env`. Details: `README.md` (Admin sign-in).

## Feature package contract
- A feature is a package under the features directory whose `package.json` has `"fluxkit": { "feature": "<name>" }`. The folder name is irrelevant.
- `main` (default `dist/index.js`) must export `featureModule`, a Nest module. It is imported dynamically and mounted only if `<name>` is in `FEATURES_ENABLED`.
- Core never imports features statically. Enabled but missing or broken feature: startup fails loudly. Disabled or deleted feature: no effect.
- Admin routes of a feature: features cannot import from `apps/api` (module boundary rule), so they use a plain `@Controller("admin/<name>")`. The API's global default-deny guard
  (`AdminPathGuard`) protects every path under `/admin` (see `docs/contracts/api.md`), so such a route answers `401` when nobody is signed in, without the feature importing anything. A plain `@Controller` has no permission metadata, so it answers `403 forbidden` to every signed-in admin: a feature route must declare its permission with `@RequirePermission` (`apps/api/src/auth/route-access.ts`) or is unusable until the extension point for features exists.
  Routes of a feature outside `/admin` are NOT guarded by the core: a feature that exposes a privileged route elsewhere owns its authorization.
