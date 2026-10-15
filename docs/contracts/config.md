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

Invalid values fail startup with a readable `Invalid environment: ...` error.

## Feature package contract
- A feature is a package under the features directory whose `package.json` has `"fluxkit": { "feature": "<name>" }`. The folder name is irrelevant.
- `main` (default `dist/index.js`) must export `featureModule`, a Nest module. It is imported dynamically and mounted only if `<name>` is in `FEATURES_ENABLED`.
- Core never imports features statically. Enabled but missing or broken feature: startup fails loudly. Disabled or deleted feature: no effect.
- Admin routes of a feature: features cannot import from `apps/api` (module boundary rule), so they use a plain `@Controller("admin/<name>")`. The API's global default-deny guard
  (`AdminPathGuard`) protects every path under `/admin` (see `docs/contracts/api.md`), so such a route answers `401` when nobody is signed in, without the feature importing anything. A plain `@Controller` has no permission metadata, so it answers `403 forbidden` to every signed-in admin: a feature route must declare its permission with `@RequirePermission` (`apps/api/src/auth/route-access.ts`) or is unusable until the extension point for features exists.
  Routes of a feature outside `/admin` are NOT guarded by the core: a feature that exposes a privileged route elsewhere owns its authorization.
