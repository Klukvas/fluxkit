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
| `SHOP_CURRENCY` | no | `UAH` | The one currency the shop sells in. Exactly one of `UAH`, `USD`, `EUR`, `PLN`, `GBP`, `CZK`, `CHF`, `CAD`, `JPY`, `KWD` (upper case, the table of `@fluxkit/core`); anything else, including a lower-case code or an empty value, fails startup. An active variant needs a price in this currency to be published or switched on; prices in other currencies may be stored but are never sold or converted. **Changing it after data exists** hides every live product that has no price in the new currency: the store lists nothing for it (a list without it, a detail answering 404) while the product stays `active` in the admin. Price the variants in the new currency first (`PUT /admin/products/{id}/prices`, up to 500 prices per call), then change the setting. `pnpm seed` does not help: it never prices or stocks products that already exist |
| `PRICES_INCLUDE_TAX` | no | `true` | Whether stored prices already include tax. Exactly `true` or `false`. Only a flag for the storefront: no tax is calculated |
| `LOW_STOCK_THRESHOLD` | no | `5` | Available quantity at or below which (and above 0) a tracked variant is `low_stock`. Whole number from 0 to 1 000 000 000, digits only. Read by the API and used by the store API (`availability`: `low_stock` from 1 up to and including this threshold) |

Invalid values fail startup with a readable `Invalid environment: ...` error.

`pnpm db:migrate` reads only `DATABASE_URL` (through `loadEnv`, like the other commands; no default, a missing value fails with exit code 1) and takes no arguments. It applies the migrations of `apps/api/drizzle/` forward only and never rolls back (rollbacks are the manual `drizzle/NNNN_name.down.sql` scripts). Details: `README.md` (Database migrations).

`pnpm admin:create` reads the same file and `DATABASE_URL` (and the locale variables) through `loadEnv`, plus one variable that only that command reads: `ADMIN_PASSWORD`, the password of the user to create (12 to 128 characters). It is not a setting of the API and is deliberately absent from `.env.example`: pass it for one command (`ADMIN_PASSWORD=... pnpm admin:create --email ...`) or type the password at the prompt instead; do not store it in `.env`. Details: `README.md` (Admin sign-in).

## Feature package contract
- A feature is a package under the features directory whose `package.json` has `"fluxkit": { "feature": "<name>" }`. The folder name is irrelevant.
- `main` (default `dist/index.js`) must export `featureModule`, a Nest module. It is imported dynamically and mounted only if `<name>` is in `FEATURES_ENABLED`.
- Core never imports features statically. Enabled but missing or broken feature: startup fails loudly. Disabled or deleted feature: no effect.
- Admin routes of a feature: features cannot import from `apps/api` (module boundary rule), so they use a plain `@Controller("admin/<name>")`. The API's global default-deny guard
  (`AdminPathGuard`) protects every path under `/admin` (see `docs/contracts/api.md`), so such a route answers `401` when nobody is signed in, without the feature importing anything. A plain `@Controller` has no permission metadata, so it answers `403 forbidden` to every signed-in admin: a feature route must declare its permission with `@RequirePermission` (`apps/api/src/auth/route-access.ts`) or is unusable until the extension point for features exists.
  Routes of a feature outside `/admin` are NOT guarded by the core: a feature that exposes a privileged route elsewhere owns its authorization.
