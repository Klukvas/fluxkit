# Contract: public HTTP API

Status: the catalog surface (`/admin/*`, `/store/*`) is public in the code but not released yet; no SemVer release has been made, so the contract can still change before the first one (recorded in `CHANGELOG.md`).
Source of truth: `docs/api/openapi.json` (generated, `pnpm openapi:export`). Readable map of every route and its errors: `docs/api/catalog.md`. Per-module notes: `docs/api/`.
Breaking changes follow AGENTS.md section 17: major version, migration guide in `docs/migrations/`, `CHANGELOG.md` entry; deprecate first when possible.

## What is contract

| Surface | Contract | Notes |
|---|---|---|
| `GET /health` | yes | liveness and database reachability (`docs/api/health.md`) |
| `GET /store/categories`, `GET /store/products`, `GET /store/products/{slug}` | yes | every response shape, every query parameter, the locale rules, the visibility rules (see `docs/api/catalog.md`, Store) |
| `/admin/*` routes | yes, as of this release | every route, request and response shape, status code and problem code listed in `docs/api/catalog.md` (catalog) and `docs/api/auth.md` (sign-in and users) |
| Admin price endpoints | yes (new in this release, additive) | `GET`, `PUT`, `DELETE` on `/admin/products/{id}/variants/{variantId}/prices[/{currency}]` and the bulk `PUT /admin/products/{id}/prices`: the money shape (`amount` and `compareAtAmount` as JSON integers in minor units, upper-case ISO 4217 `currency`), the bulk limit of 500 items, the error codes and the `last_shop_price` rule (`docs/api/pricing.md`). The config variables `SHOP_CURRENCY`, `PRICES_INCLUDE_TAX` and `LOW_STOCK_THRESHOLD` are contract too (`docs/contracts/config.md`) |
| Publish and activation need a price | yes (behavior change, pre-1.0) | `POST /admin/products/{id}/publish` answers `400 validation_failed` with `price_missing` at `variants.N` for an active variant without a price in `SHOP_CURRENCY`; `PATCH .../variants/{variantId}` with `isActive: true` on an active product answers `409 rule_violation` `price_missing`. Before this release publishing did not look at prices. Clients that publish must price first; no migration guide because the contract is not released yet |
| Admin authentication | yes | cookie session, CSRF header, roles and permissions, login and users endpoints: see "Admin authentication" below |
| Default deny for `/admin` | yes | A global guard (`AdminPathGuard`, `APP_GUARD`) protects EVERY route whose path starts with `/admin` (matched case-insensitively, trailing slash included), whether or not its controller uses `@AdminController`. This covers routes added by feature modules: a feature may declare a plain `@Controller("admin/<name>")`; it is `401` without a session and `403` for a signed-in admin (no permission is declared), never open. An oversized JSON body (over 100 KB) is rejected with `413` before any guard runs, also on `/admin/*`; malformed JSON answers `400`; both are `application/problem+json` and not logged as errors |
| Error model | yes | `application/problem+json` with the `code` values and status mapping in `docs/api/catalog.md` (Conventions). New codes are additive (minor); removing or renaming one is breaking |
| Pagination | yes | `?limit` and `?offset` bounds and the `{items, total, limit, offset}` shape |
| Locale handling | yes | `?locale=` against the configured `LOCALES`; missing means `DEFAULT_LOCALE`; per-field fallback |

Adding an optional request field, a response field, a route, or a new problem `code` is a minor change. Removing or renaming any of them, changing a type, or tightening a validation rule is breaking.

## Admin authentication (ADR 0009, `docs/api/auth.md`)

Contract:

| Item | Rule |
|---|---|
| Session | `POST /admin/auth/login` answers `200` and sets a session cookie; every other `/admin` request is authenticated by that cookie alone (an `Authorization` header, API key or query parameter is ignored). `POST /admin/auth/logout` ends the session. Idle and absolute lifetimes come from `ADMIN_SESSION_IDLE_MINUTES` and `ADMIN_SESSION_MAX_HOURS` (`docs/contracts/config.md`). The cookie is `HttpOnly`, `SameSite=Strict`, `Path=/admin`, and `Secure` unless `ADMIN_COOKIE_SECURE=false` |
| CSRF header | Every `POST`, `PUT`, `PATCH` and `DELETE` under `/admin`, login included and also for anonymous callers, must send `X-Fluxkit-CSRF: 1` and, when it has a body, `Content-Type: application/json`; otherwise `403 forbidden`. `GET`, `HEAD` and `OPTIONS` are exempt. The API sends no CORS headers |
| Roles | `owner`, `manager`, `viewer`; fixed in code (a new role is a code change, not data). The names are contract |
| Permissions | `catalog.read`, `catalog.write`, `catalog.publish`, `users.manage`. The names are contract |
| Login response | `200 {"user": {id, email, role, isActive, lastLoginAt}}` plus the cookie. Every failure (unknown email, wrong password, locked account, inactive user) answers the same `401 unauthorized` with no cookie; status, headers and body do not say which. Response times are similar (one scrypt each) but not guaranteed equal: a wrong password also writes the failure count, so a small difference can exist. `GET /admin/auth/me` answers `{user, permissions}` |
| Caching | Every response under `/admin` (matched like the guard: case-insensitive, trailing slash included), errors included, carries `Cache-Control: no-store`. `/store/*` and `/health` are not affected |
| Users endpoints | `GET` and `POST /admin/users`, `GET` and `PATCH /admin/users/{id}`, `POST /admin/users/{id}/reset-password`, owner only; no delete; the last active owner cannot be demoted or deactivated. Shapes and errors: `docs/api/auth.md` |

| Role | `catalog.read` | `catalog.write` | `catalog.publish` | `users.manage` |
|---|---|---|---|---|
| `owner` | yes | yes | yes | yes |
| `manager` | yes | yes | yes | no |
| `viewer` | yes | no | no | no |

Route to permission: `GET` and `HEAD` need `catalog.read`; every other method needs `catalog.write`; `publish`, `unpublish`, `archive` and `restore` of a product need `catalog.publish`; the users routes need `users.manage`. `logout`, `me` and `change-password` need only a session. A route that declares no permission is denied.

Problem codes added by auth:

| Code | Status | Meaning |
|---|---|---|
| `unauthorized` | 401 | no valid session (missing, malformed, unknown or expired cookie, deactivated user) or a failed login |
| `forbidden` | 403 | signed in but the role lacks the route's permission, or the CSRF rule above was broken |
| `too_many_requests` | 429 | too many login attempts from one client address; `Retry-After` carries the seconds to wait |

Not contract (internal, may change in a minor release): the scrypt parameters and the hash format, the session token format and how sessions are stored, the cookie name `fluxkit_admin_session`, the lockout numbers (5 failures, 15 minutes) and the IP limit numbers (20 attempts per 10 minutes; IPv6 counted per /64), the exact `detail` texts. Clients keep the cookie jar of their HTTP client and do not read the cookie value.

Known limits:

- The IP login limit is in memory, per API process: it resets on restart and is not shared between instances. The account lockout is in the database and does span instances.
- `request.ip` is the socket address unless Express `trust proxy` is configured, which the API does not do yet. Behind a reverse proxy all clients then share one IP window.
- No password reset by email, no two-factor authentication, no audit log of sign-ins (follow-ups in `docs/plans/2026-10-16-auth-and-roles.md`). Customer accounts are a separate plan.

## Stability of identifiers (ADR 0006 section 10)

| Identifier | Rule |
|---|---|
| `id` (UUID) | Opaque and stable for the life of the row. Clients must not parse it. |
| `code` (attribute, attribute option, option, option value, product type) | Never renamed by the system; set once on create. Storefront clients may branch on codes, so the admin API refuses code changes (`code` in a PATCH is `400 unknown_field`). |
| `slug` (product, category, brand) | Editable by the admin only. The old slug is freed at once; there are no redirects in v1 (a redirect table is planned with the storefront SEO work). The store API answers `404` for an archived product's slug. |
| `sku` | Globally unique; normalized (trimmed, uppercased) by the service. Editable, with no history. |

## What is not contract

- `optionSignature` on variants (admin): derived internal data, read-only, may change format.
- `position` values: the order is contract (lists are ordered as documented); the numbers are not. Clients must not depend on gaps or on the exact value.
- Internal attributes (`isInternal`) and attributes not visible on the storefront: never returned by `/store/*`, never documented as a store shape. Admin responses show them to admins; their existence and codes are not a storefront contract.
- Store fields not listed in `docs/api/catalog.md` (for example `barcode`, `isDefault`, variant `position`, timestamps other than `publishedAt`).
- The order of JSON object keys, and the exact wording of `detail` and `message` texts in problem bodies. Clients use `code`, `status` and `errors[].path` / `errors[].code`.
- Routes and fields that are documented as not yet implemented (for example inventory, price fields in the store API, search, cart, customer accounts) are not in this contract; they arrive with their own plans.
- The `pnpm admin:create` command is a tool, not an API; its options are described in `README.md` (Admin sign-in).

## Versioning

- SemVer for the template (`AGENTS.md` section 17). Routes live under `/admin` and `/store` without a version segment; a breaking change to a route means a new major version of the template and a migration guide, not a silent edit.
- Before the first release the contract may still change; the change is still recorded in `CHANGELOG.md`.
