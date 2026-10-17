# apps/api

- `src/main.ts` - bootstrap: load env, create app, serve Swagger UI at `/docs`, listen.
- `src/index.ts` - placeholder entry (`export {}`); no public exports yet.
- `src/app.factory.ts` - `createApp` (loads features, passes the admin session settings, builds Nest app, shutdown hooks) and `buildOpenApiDocument`; used by main, tests, export.
- `src/app.module.ts` - root module; composes database, auth, rate limits, customer auth, customer accounts, common, health, catalog, inventory and dynamically loaded feature modules. Must not import features statically.
- `src/openapi-export.ts` - writes `docs/api/openapi.json` (run via `pnpm openapi:export`); never contacts the database.
- `src/openapi.spec.ts` - fails when the committed `openapi.json` is stale.

## Common (`src/common/`)

- `common.module.ts` - global module: the problem filter for every route and the locale and pricing configuration (`LOCALE_CONFIG`, `PRICING_CONFIG`).
- `locale.ts` - `LOCALE_CONFIG` token and `LocaleConfig` (`defaultLocale`, `locales`), fed from `DEFAULT_LOCALE` and `LOCALES`.
- `pricing-config.ts` - `PRICING_CONFIG` token, `PricingConfig` (`shopCurrency`, `pricesIncludeTax`, `lowStockThreshold`), its defaults and `toPricingConfig` (narrows the validated currency string to core's type, loud on a mismatch); fed from `SHOP_CURRENCY`, `PRICES_INCLUDE_TAX`, `LOW_STOCK_THRESHOLD`. `pricing-config.spec.ts` asserts the config package and core agree on the currency list.
- `problem.ts` - error codes (`PROBLEM_CODES`), status and title maps, `ProblemException` and factories (`validationFailed`, `notFound`, `conflict`, `inUse`, `invalidTransition`, `ruleViolation`, `unauthorized`, `forbidden`, `tooManyRequests` with its `Retry-After` header). Must not carry SQL or internals.
- `problem.filter.ts` - the one `application/problem+json` writer: known problems pass through, framework 4xx get generic details, unknown errors are logged (method and path only) and answered as `internal_error`. A query error (`DrizzleQueryError`, a `Failed query:` message, or `query`/`params` properties) is logged as class names plus the innermost cause's name and code, never its message. Sets `Cache-Control: no-store` on `/admin` errors that happen before any middleware (body-parser 413).
- `postgres-errors.ts` - maps SQLSTATE and constraint names to problems (`23505` to `conflict` with `field`, `23503` to `in_use` or `invalid_reference`, `23514` to `validation_failed`). Never maps by message text.
- `zod-validation.pipe.ts` - validates `@Body`, `@Query`, `@Param` with zod and turns issues into `errors[]` (`required`, `unknown_field`, ...); `uuidParam` for id parameters.
- `pagination.ts` - admin `?limit` (default 50, max 100) and `?offset` (max 10 000) schema, `Page<T>`, `toPage`, `pageSchema` for OpenAPI.
- `openapi.ts` - OpenAPI helpers: `ApiZodBody`, `ApiZodResponse` (schema from the same zod schema as the validation), `ApiPaginationQuery`, `ApiProblemResponses` and the problem document models.
- `openapi-formats.ts` - response-only schemas (`uuidSchema`, `timestampSchema`) with OpenAPI formats.
- `admin-path.ts` - `isAdminPath` (the `/admin` test, case-insensitive like Express routing) and `markAdminResponseUncacheable` (`Cache-Control: no-store`); used by the guard, the auth middleware and the problem filter.
- `store-path.ts` - `isStorePath` and `isStoreAccountPath` (case-insensitive like Express routing) and `markStoreAccountResponseUncacheable` (`Cache-Control: no-store` for everything under `/store/account`); used by the store CSRF guard, the customers module middleware and the problem filter.
- `error-summary.ts` - `summarizeError`, `innermostCause`, `errorCode`: what is safe to log about a failure (class names and a code, never the message, which can hold SQL and parameters).
- `transaction.ts` - `withTransaction` and the `DbExecutor` / `Transaction` types used by repositories and services.
- `*.spec.ts` - unit tests for the filter, pipe, pagination, Postgres error mapping and transaction helper.

## Auth (`src/auth/`)

- `admin-authenticator.ts` - `AdminAuthenticator` contract (`authenticate(request)` returns an `AdminPrincipal` or `undefined`) and the `AdminPrincipal` type. No environment switch, no API key.
- `session-admin-authenticator.ts` - the production authenticator: session cookie -> `SessionService.resolve` -> principal with the role's permissions. Rethrows internal failures (500), never turns them into access.
- `session.service.ts` - sessions: `create` (32-byte random token, only its SHA-256 stored), `resolve` (core `evaluateSession`, active user, role read from the database every call, `last_seen_at` touched at most once a minute, expired sessions deleted), `revoke`, `revokeSession` (by id, logout), `revokeAllForUser` (optionally inside the caller's transaction), `create` also inside the caller's transaction (login), `deleteExpired` (all users) and `deleteExpiredForUser`. Never logs tokens.
- `session.repository.ts` - Drizzle queries on `admin_session` joined to `admin_user`; `insert` and `deleteExpired` accept the caller's transaction. Tables only, no rules.
- `session-cleanup.ts` - `ExpiredSessionCleanup`: deletes all expired sessions once at application bootstrap (no timers); a failure is logged as a warning (class, cause, code) and never blocks startup. Switched off for command-line contexts (`cleanExpiredSessionsOnBootstrap: false`).
- `session-cookie.ts` - cookie name, safe `Cookie` header parsing (first valid occurrence), `setSessionCookie` / `clearSessionCookie` with the fixed flags. Must not hold session rules.
- `password-hasher.ts` - `PasswordHasher`: `node:crypto` scrypt (asynchronous), self-describing `scrypt$N$r$p$salt$hash`, `verify` (timing-safe, false on malformed input), `needsRehash`, `verifyDummy`.
- `clock.ts` - `Clock` and `SystemClock`, injected so tests control time.
- `auth-config.ts` - `AdminAuthConfig` (cookie `Secure`, idle minutes, maximum hours) and its secure defaults.
- `admin.guard.ts` - `AdminGuard`: CSRF check, public short circuit, authentication (401), permission (403), once per request; `AdminPathGuard`: the global guard for every path under `/admin`.
- `csrf.ts` - `assertCsrfSafe(request, scope)`: the `X-Fluxkit-CSRF: 1` header and JSON content type for state-changing methods; the one rule behind `/admin` (`AdminGuard`, scope `admin`, the default) and `/store` (`StoreCsrfGuard`, scope `store`; only the message differs).
- `route-access.ts` - `@RequirePermission`, `@PublicAdminRoute`, `@AuthenticatedAdminRoute` (any signed-in admin, no permission: logout, me, change-password), `UseDefaultPermissionByMethod(defaults?)` and `resolveRouteAccess` (route, then controller, then the controller's default pair by HTTP method: `read` for GET and HEAD, `write` otherwise; `CATALOG_DEFAULT_PERMISSIONS` when none is named). Must not hold role tables: those are in `@fluxkit/core`.
- `auth.controller.ts` - `/admin/auth/*`: login (public; sets the cookie), logout, me, change-password. Thin: validates, calls the service, sets or clears the cookie. No rules.
- `auth.service.ts` - login (one scrypt per failure, identical 401, core lockout under a row lock, rehash, expired-session cleanup and the new session inside the same locked transaction), me, change-password; logs reason codes only. Must not log emails, passwords, hashes or tokens.
- `auth.schemas.ts` - zod schemas of the auth bodies and responses (structural limits only; policy runs in core).
- `login-throttle.ts` - `LoginThrottle`: the ADMIN login limit (20 per 10 minutes), a thin subclass of `IpWindowLimiter` (`src/rate-limit/`); re-exports `throttleKeyOf`. Behaviour unchanged by the generalization.
- `session-token.ts` - shared by admin and customer sessions: `generateSessionToken` (32 random bytes, base64url), `hashSessionToken` (SHA-256 hex), `isWellFormedSessionToken`, `SESSION_TOKEN_PATTERN` and `readTokenCookie` (exact cookie name, first well-formed occurrence, never throws). Must not know a cookie name or a table.
- `admin-no-store.middleware.ts` - sets `Cache-Control: no-store` on every `/admin` response; registered by `AuthModule.configure`.
- `admin-user.repository.ts` - Drizzle queries on `admin_user` (find, list, insert, update, row lock, active owners) and the key of the advisory lock that serializes owner changes. Queries only, no rules.
- `admin-user.mapper.ts` - row to the user shape of the auth responses (an allow list: the hash cannot leak).
- `password-policy-errors.ts` - core `validatePassword` result as `errors[]` for a request path.
- `users/` - owner-only user management: `users.controller.ts` (`@RequirePermission("users.manage")` on the class), `users.service.ts` (core email and password rules, last-owner rule inside a locked transaction, session revocation), `users.schemas.ts`, `users.mapper.ts`; `users.spec.ts` (every route, role matrix, escalation), `users-concurrency.spec.ts` (last owner under concurrent requests and the lock).
- `current-admin.ts` - `@CurrentAdmin()` parameter decorator; the principal lives in a `WeakMap` keyed by the request.
- `admin-controller.decorator.ts` - `@AdminController(resource, defaults?)`: `/admin/<resource>` with the guard, the default permission by method (the catalog pair unless `{read, write}` is given, as `/admin/customers` does), the Swagger tag, and the 401, 403 and 500 problem responses. Use it for every admin controller.
- `auth.module.ts` - global `AuthModule.register(options)`: config, clock, hasher, session service, login throttle, auth and users controllers and services, the authenticator (session-based unless a test replaces it) and the guards.
- `create-admin.ts` - entry of `pnpm admin:create` (built output run by Node, like `seed.ts`): wires the real terminal prompt, prints `Created <role> <email> (id ...)` or the error, exit code 1 on failure. No logic.
- `create-admin-command.ts` - the command: argument parsing (`--email`, `--role`; any password-like argument is refused), password from `ADMIN_PASSWORD` or the prompt, core email and password rules, standalone Nest context, insert through `AdminUserRepository`. Creates only: an existing email is refused. Must NOT print or log the password or the hash (unexpected errors are redacted).
- `unlock-admin.ts` - entry of `pnpm admin:unlock` (built output run by Node): prints `Unlocked <email>` or `<email> was not locked`, or the error with exit code 1. No logic.
- `unlock-admin-command.ts` - the command: strict argument parsing (`--email` only; any password-like argument is refused), email normalized like login, standalone Nest context, one transaction under the row lock that sets `failed_login_count = 0` and `locked_until = null`. Must NOT touch the password, role, active flag or sessions, and must NOT print secrets (unexpected errors print class names and a code only).
- `unlock-admin-command.spec.ts`, `unlock-admin-entry.spec.ts` - arguments, real-Postgres unlock after real failed logins, untouched columns, secrecy, and the built entry as a real process.
- `create-admin-prompt.ts` - no-echo prompt on node `readline` (typed characters go to a sink stream); asks twice, rejects when the input ends.
- `create-admin-command.spec.ts`, `create-admin-prompt.spec.ts`, `create-admin-entry.spec.ts` - arguments, password sources, real-Postgres creation and refusals, secrecy, and the built entry run as a real process (needs `pnpm build`, which `pnpm test` does).
- `*.spec.ts` - hasher, cookie, CSRF, session service (real Postgres), guard unit tests, `login-throttle.spec.ts`, `auth-login.spec.ts` (identical failures, lockout, IP limit, logging), `auth-session-endpoints.spec.ts` (logout, me, change-password), `auth-secrecy.spec.ts` (no hash in any response or log); `admin-default-deny.spec.ts` (401 on every route, probe controllers), `admin-permissions.spec.ts` (route walk, role matrix), `admin-csrf.spec.ts` (CSRF and no-CORS), `session-authentication.spec.ts` (cookie end to end), `auth-consistency.spec.ts` (`ROLES` vs the database CHECK, config defaults vs core), `auth-login-race.spec.ts` (login racing a password reset), `session-cleanup.spec.ts` (bootstrap cleanup), `admin-no-store.spec.ts` (`Cache-Control`).

## Rate limits (`src/rate-limit/`)

- `ip-window-limiter.ts` - `IpWindowLimiter`: one per client address fixed-window limit, in memory, bounded (`maxClients`), clock injected; `throttleKeyOf` keys IPv6 by its /64 prefix and maps IPv4-mapped addresses to IPv4. Single process only (documented in the file). The code of the former admin login throttle, moved here unchanged.
- `rate-limiter.ts` - `RATE_LIMITS` (named internal limits: `login`, `registration`, `checkout`, `orderLookup`, `guestCancel`, `cartWrite`) and `RateLimiter`, one `IpWindowLimiter` per name so limits never share counts.
- `rate-limit.decorator.ts`, `rate-limit.guard.ts` - `@RateLimit(name)` on a route or controller and the guard behind it: `429 too_many_requests` with `Retry-After`. A route without the decorator is not limited.
- `rate-limit.module.ts` - global `RateLimitModule.register(overrides?)` (the overrides are for tests). Needs `CLOCK` from `AuthModule`.
- `*.spec.ts` - windows, per-key and per-name isolation, IPv6 /64 grouping, bounded memory, the guard unit and the real-app `429`; `ip-window-limiter.spec.ts` also asserts the admin throttle is the same limiter with its own limit.

## Customer auth (`src/customers/auth/`)

Infrastructure of plan step 3a (ADR 0016, `docs/api/customers.md`); the routes that use it are in "Customer accounts" below.

- `customer-auth-config.ts` - `CustomerAuthConfig` (cookie `Secure`, idle minutes, maximum hours) and its secure defaults.
- `customer-session.repository.ts` - Drizzle queries on `customer_session` joined to `customer`. Tables only, no rules.
- `customer-session.service.ts` - `create` (always a new token; only its SHA-256 stored; optionally inside the caller's transaction), `resolve` (core `evaluateSession`, active customer, read from the database every call, `last_seen_at` touched at most once a minute, expired sessions deleted), `revoke`, `revokeSession`, `revokeAllForCustomer` (optionally keeping one session). Never logs tokens.
- `customer-session-cookie.ts` - cookie name `fluxkit_customer_session`, `readCustomerSessionCookie` (that name only), `setCustomerSessionCookie` / `clearCustomerSessionCookie` (`HttpOnly`, `SameSite=Lax`, `Path=/store`, `Secure`). Must not hold session rules.
- `customer-authenticator.ts`, `session-customer-authenticator.ts` - the `CustomerPrincipal` (`customerId`, `email`, `sessionId`; no role) and the production authenticator: cookie only, never a header, query or the admin cookie; internal failures are rethrown (500).
- `current-customer.ts` - `@CurrentCustomer()`; the principal lives in a request-keyed `WeakMap`.
- `customer.guard.ts`, `customer-authenticated.decorator.ts`, `customer-route.ts` - `@CustomerAuthenticated()` (method or controller) marks a store route as customer-authenticated; `CustomerGuard` answers the identical `401`, sets `Cache-Control: no-store` and checks a request once. The store stays public by default.
- `store-csrf.guard.ts` - global `StoreCsrfGuard`: `X-Fluxkit-CSRF: 1` on every state-changing request under `/store`, whatever module serves it (reuses `assertCsrfSafe`).
- `customer-auth.module.ts` - global `CustomerAuthModule.register({config})`: sessions, authenticator, guards and the `APP_GUARD` of the store CSRF rule.
- `*.spec.ts` - session service (real Postgres), cookie flags (real Express), guard units, `customer-auth.spec.ts` (end to end through a test probe: identical 401s, expiry, deactivation, revoke, cookie-only, hash-only storage), `customer-admin-separation.spec.ts` (customer cookie on every `/admin` route, admin cookie on customer routes, both cookies, same email), `store-csrf.spec.ts`, `customer-routes.spec.ts` (route walk: marked routes reject anonymous callers, `/store/account` routes must be marked), `customer-auth-config.spec.ts` (config wiring and consistency with core).

## Customer accounts (`src/customers/`)

Plan step 3b (ADR 0016, `docs/api/customers.md`). Core, no feature flag. `customers.module.ts` registers both controllers and a middleware that sets `Cache-Control: no-store` on `/store/account/*`.

- `customer.repository.ts` - Drizzle queries on `customer` (find by normalized email or id, `FOR UPDATE`, list with a literal email prefix via `starts_with`, insert, update, order count over `sales_order`). Tables only, no rules.
- `account/account.service.ts` - register, login, me, profile update and change-password. The sign-in flow mirrors the admin `AuthService` (identical `401`, one scrypt per failure, lockout through core `registerFailedLogin`, row-locked completion, new session, previous session revoked); rules (email, names, phone, password policy) are core functions. `afterSignIn` is an empty step with `TODO(fluxkit): step 4 merges the guest cart here`. Must not log emails, passwords, tokens or ids.
- `account/account.controller.ts` - `/store/account/*`: validates, calls the service, sets or clears the cookie. Register and login are the only routes without `@CustomerAuthenticated()`; they carry `@RateLimit("registration")` and `@RateLimit("login")`. No rules here.
- `account/account.schemas.ts`, `account/customer.mapper.ts` - strict zod bodies (structure only; the admin login and change-password schemas are reused) and the allow-list mapper to `{id, email, firstName, lastName, phone, createdAt}`.
- `admin/admin-customers.controller.ts`, `admin/admin-customers.service.ts`, `admin/admin-customers.schemas.ts` - `/admin/customers`: `@AdminController("customers", {read: "customers.read", write: "customers.write"})`; list, get with a real order count, activate/deactivate (revokes all sessions in the same transaction under the row lock) and unlock. No create, delete or password route.
- `*.spec.ts` (real Postgres, HTTP level) - `account-register`, `account-login` (cookie attributes, identical failures, one hash computation per failure, lockout with the injected clock, fixation, rate limit), `account-session` (logout, me ownership, strict PATCH, change-password and session revocation), `account-secrecy` (logs, tables, hash format, responses), `account-separation` (customer and admin principals on the real routes, same email), `admin-customers` (permission matrix, list, get, deactivation, unlock).

## Catalog (`src/catalog/`)

- `catalog.module.ts` - core catalog module (no feature flag); imports every admin resource module and `StoreModule`.
- `shared/attribute-usage.ts` - "is this attribute in use" facts for the core change rules (JSONB keys in `product` and `variant`). Must not decide the rules itself.
- `shared/code-schemas.ts` - zod schemas for codes (`code`, value code) and the limits they use.
- `shared/i18n-validation.ts` - zod schema for i18n texts that calls core `validateI18nText` with the configured locales.
- `shared/rules.ts` - `assertAllowed`: turns a rejected core decision into `409 rule_violation` with the core reason as `rule`.
- `shared/stock-flags.ts` - `initialStockFlags(requiresShipping)`: the stock flags a new variant starts with (untracked for a product type that does not ship). Must NOT decide stock rules.
- `shared/text.ts` - `emptyToNull` for text maps; `isDatabaseSafeText` (zod refinement over core `hasJsonbUnsafeCharacters`: NUL and unpaired surrogates) for free-text columns.
- `shared/retry.ts` - `retryLostRaces` and `ProposalLog`: run a whole transaction again when a slug or SKU the service proposed lost a race; stops with 409 when a round proposes what the previous round did. Never use it for a value the client sent.

### Admin (`src/catalog/admin/`)

Each resource folder has `<name>.controller.ts` (HTTP only), `<name>.service.ts` (rules via core, transactions), `<name>.repository.ts` (Drizzle queries), `<name>.schemas.ts` (zod request and response shapes), `<name>.mapper.ts` (row to API shape), `<name>.module.ts`, and `*-auth.spec.ts` (default deny: 401 without the test authenticator) plus `<name>.spec.ts` (HTTP integration tests on real Postgres).

- `attributes/` - attributes and their options: `/admin/attributes`, `/admin/attributes/{id}/options`. Change rules from `decide*`.
- `options/` - options (variant axes) and values: `/admin/options`, `/admin/options/{id}/values`.
- `product-types/` - product types and their attribute and option assignments: `/admin/product-types`, `PUT`/`DELETE` on `.../attributes/{attributeId}` and `.../options/{optionId}`.
- `brands/` - `/admin/brands`; slug generation and conflicts.
- `categories/` - `/admin/categories` and `POST .../move`; depth, cycles and the tree-wide advisory lock on move.
- `products/` - `/admin/products` CRUD, lifecycle (`publish`, `unpublish`, `archive`, `restore`), `PUT .../categories`, `PUT .../media`; publish preconditions from core. `products.schemas.ts` holds the caps for categories and media.
- `product-options/` - `PUT /admin/products/{id}/options` and `POST .../options/{optionId}/values`; draft-only replacement, frozen options after publish; a change that rebuilds all variants is refused with `has_stock_history` (core `canRebuildVariants`, fact from `VariantsRepository.anyHasStockHistory`, ADR 0014).
- `variants/` - `/admin/products/{id}/variants` (list, create, get, patch, delete) and `POST .../variants/generate`; `variant-generation.service.ts` runs core `generateVariants` and retries proposed SKU collisions (never client-sent SKUs). Switching a variant on in an active product also needs a shop-currency price (core `price_missing`, only for the activated variant). Variant create and patch also take the stock flags `trackInventory` and `allowBackorder`; generated variants of a product type that does not ship start untracked.
- `prices/` - admin price endpoints (`docs/api/pricing.md`): `prices.controller.ts` (`GET|PUT|DELETE .../variants/{variantId}/prices[/{currency}]`, bulk `PUT /admin/products/{id}/prices`; HTTP only), `prices.service.ts` (core `validatePrice`, product row lock, the `last_shop_price` delete rule, all-or-nothing bulk; no money arithmetic), `prices.repository.ts` (`price` table queries, one-statement upsert), `prices.schemas.ts` (structure only, the 500-item bulk cap), `prices.mapper.ts` (row to money shape; `toSafeAmount` refuses a `bigint` outside the amount range), `prices.spec.ts` and `prices-auth.spec.ts` (HTTP tests on real Postgres). Must NOT sell, convert or compute totals.
- `products/products.repository.ts` also answers `requiresShipping` (a product type that does not ship starts its variants untracked, `shared/stock-flags.ts` `initialStockFlags`) and the publish price fact (`findVariantIdsWithPrice`, one query per product); `products.mapper.ts` turns it into `hasShopPrice` for core.

### Store (`src/catalog/store/`)

- `store.module.ts` - `StoreModule`: public controllers and read-only repository.
- `store-controller.decorator.ts` - `@StoreController(resource)`: `/store/<resource>`, no guard, read-only, the `store` Swagger tag.
- `store-categories.controller.ts` - `GET /store/categories`.
- `store-products.controller.ts` - `GET /store/products` and `GET /store/products/{slug}`.
- `store-config.controller.ts` - `GET /store/config` (shop currency with exponent, tax flag, locales; no database access).
- `store-pricing.ts` - feeds core `pickSellablePrice` and `availabilityOf` for the sellable variants and aggregates per product (`from`/`to`, best availability). Must NOT compute a price or an availability itself.
- `store.schemas.ts` - query and response shapes of the store API; the page size default (24) lives here.
- `store.service.ts` - store rules: locale resolution (400 on unknown), active-only visibility, category subtree filter, image choice, order, sellable-variant set (ADR 0007 option hiding), 404 for a product with no sellable variant. Must not return internal attributes, quantities or non-shop prices.
- `store.serializer.ts` - the one place that emits attribute values and definitions to clients, via core `selectPublicAttributes` and `publicAttributeDefinitions`; `requiredText` logs and degrades to `""` when a required text has no locale.
- `store-categories.ts` - builds the visible category tree (every ancestor active) and the subtree of a slug.
- `store.repository.ts` - read-only Drizzle queries (batch loads, no N+1). Must not apply business rules beyond SQL filters (`status`, `is_active`, the shop-currency price join); prices and stock levels are loaded for a set of product ids in one query each.
- `store.spec.ts` - HTTP tests: visibility, leaks of internal attributes, locale, pagination bounds, query counts, prices, availability, hiding of unpriced variants, `GET /store/config`, leak scans for stock and price data.

## Inventory (`src/inventory/`)

Core module (no feature flag), docs in `docs/api/inventory.md`. `inventory.module.ts` wires the admin stock API and the reservation service and exports `ReservationsService` for the checkout plan. Stock rules live in `packages/core/src/inventory` (`decide*`, `availabilityOf`); nothing here duplicates them: the code feeds core the current level under a row lock and writes what it decides.

- `inventory.repository.ts` - `inventory_level`, `location` and `stock_movement` queries: `lockLevel` (`SELECT ... FOR UPDATE`), `insertEmptyLevel` (`ON CONFLICT DO NOTHING`), `updateLevel`, `insertMovement` (append only; `created_at` from `clock_timestamp()` under the lock) and the paginated journal read. The only writer of the journal; it has no update or delete of it.
- `admin/inventory.controller.ts` - `GET .../variants/{variantId}/inventory`, `POST .../inventory/adjustments`, `GET .../inventory/movements` (HTTP only; the acting admin comes from `@CurrentAdmin()`, never the body).
- `admin/inventory.service.ts` - the adjustment transaction (product row lock, level row lock, core `decideAdjustment`, level update, journal row; a refusal throws and rolls back; `actorId` may be `null` for a system change such as the demo seed) and the reads. Maps core refusals: bad numbers to 400, stock rules to 409 `rule_violation`.
- `admin/inventory.schemas.ts`, `admin/inventory.mapper.ts` - request and response shapes (structure only; the mapper refuses stored values outside the supported range).
- `admin/locations.controller.ts`, `admin/locations.schemas.ts` - `GET /admin/locations` (read only).
- `reservations/reservations.service.ts` - `ReservationsService`: `reserve`, `release`, `commit`, `expireDue(now, {limit, after})` with a keyset cursor; one transaction each, level row lock first, core decisions, typed refusals. No HTTP route. Must NOT read the clock or implement a stock rule.
- `reservations/reservations.repository.ts` - reservation queries (`findVariantForReservation` locks the variant row `FOR SHARE` and reads the shop-currency price fact, `lock`, `setStatus`, `listDue` ordered by `(expires_at, id)` with a keyset cursor).
- `admin/inventory.spec.ts`, `admin/inventory-auth.spec.ts`, `admin/locations.spec.ts` - HTTP tests on real Postgres: flags, refusals, journal content and actor, pagination, locks, parallel adjustments and first receipts, permissions, cascade on product delete.
- `reservations/sellable-agreement.spec.ts` - the store detail and `reserve` against core `isVariantSellable` on every combination of product status, variant activity and shop price.
- `reservations/reservations.spec.ts`, `reservations/reservations-concurrency.spec.ts` - service tests on real Postgres: every refusal, backorder, expiry batches, and parallel reservations, commits, releases and sweeps with the invariants checked after each round.
- `inventory-journal.spec.ts` - no source file updates or deletes `stock_movement` and the repository is the only writer.

## Database (`src/database/`)

- `database.module.ts` - global Postgres pool and Drizzle provider; closes the pool on shutdown. Error listeners on the pool (idle clients) AND on every client as it connects (checked-out clients), so a dropped connection inside a transaction rejects that query instead of ending the process; logs the error name and code only.
- `database.module.spec.ts` - kills the backend of a running transaction (`pg_terminate_backend`): the test process survives, the request answers 500 problem+json and the API keeps serving.
- `schema/index.ts` - schema barrel used by Drizzle and by the error mapper.
- `schema/health.ts` - `health_check` table (health probe).
- `schema/catalog.ts` - the 16 catalog tables (ADR 0006 section 2) with constraints and indexes.
- `schema/admin-auth.ts` - `admin_user` and `admin_session` tables (admin login; sessions store only a SHA-256 token hash, no IP address or user agent).
- `schema/pricing-inventory.ts` - `price`, `location`, `inventory_level`, `stock_movement` and `reservation` tables (ADR 0011, ADR 0012); limits mirror `packages/core`. The append-only trigger and the `main` location row are in the migration, not here.
- `schema/customers.ts` - `customer` (normalized unique email, scrypt hash, lockout fields) and `customer_session` (SHA-256 token hash only; ADR 0016). No link to `admin_user`.
- `schema/carts.ts` - `cart` (exactly one owner: token hash or customer) and `cart_item` (one line per cart and variant, seen price for the "price changed" notice; ADR 0015).
- `schema/orders.ts` - `sales_order`, `order_item` (immutable snapshot), `order_adjustment`, `order_status_change` and `order_item_reservation` (ADR 0017, ADR 0019); limits mirror `packages/core`. The three triggers are in the migration, not here.
- `schema/domain-events.ts` - `domain_event`, the transactional outbox (ADR 0018); no foreign key on the aggregate.
- `catalog-schema.spec.ts` - constraint tests on real Postgres (inside rolled-back transactions).
- `admin-auth-schema.spec.ts` - constraint, cascade and name tests for the admin auth tables.
- `pricing-inventory-schema.spec.ts` - CHECK boundaries, uniqueness, cascades, RESTRICT, the default location and the `stock_movement` trigger (rejections and the two documented exceptions) on real Postgres.
- `cart-orders-schema.spec.ts` - CHECK boundaries tied to the `@fluxkit/core` constants, uniqueness, foreign key actions (customer, admin user, product, variant, reservation, location, order), the three triggers (direct rejections, depth-2 exceptions through a helper trigger) and the outbox index on real Postgres.
- `migrations.spec.ts` - migrations up, down, up, down on a `*_test` database (0000 to 0004), the down script of 0004 refusing a dependent object, and an upgrade from a database holding 0003 data; refuses other database names.
- `migrate.ts` - entry of `pnpm db:migrate` (built output run by Node); prints the result, exit code 1 on any error.
- `migrate-command.ts` - `runMigrateCommand`: applies the pending migrations of `drizzle/` with the Drizzle migrator under a session-level advisory lock (`MIGRATION_LOCK_KEY`), refuses a database that is ahead of the journal, redacts connection strings and passwords from errors. Forward only: must never roll back, drop or delete. The folder is resolved from the file location, not the working directory.
- `migrate-command.spec.ts` - the command on scratch `*_test` databases: fresh, repeat, incremental, ahead refusal, advisory lock, concurrency, failing migration, redaction.
- `migrate-entry.spec.ts` - the built `dist/database/migrate.js` as a real process: same cases plus missing `DATABASE_URL`, arguments, unreachable database and other working directories.

## Migrations (`drizzle/`)

- `0000_health_check.sql` and `0000_health_check.down.sql` - the scaffold's health table.
- `0001_catalog.sql` and `0001_catalog.down.sql` - the 16 catalog tables; the down script drops them in reverse order and removes the migration's bookkeeping row.
- `0002_admin_auth.sql` and `0002_admin_auth.down.sql` - `admin_user` and `admin_session`; the down script drops them (sessions first) and removes the bookkeeping row.
- `0003_pricing_inventory.sql` and `0003_pricing_inventory.down.sql` - price and inventory tables, the `variant` stock flags, the `stock_movement_append_only` trigger function and trigger (hand-written tail of the generated file) and the default `main` location; the down script drops tables in reverse order, then the function and the variant columns, and removes the bookkeeping row.
- `0004_cart_customers_orders.sql` and `0004_cart_customers_orders.down.sql` - customer, cart, order and outbox tables and the three trigger functions and triggers (`order_item_immutable`, `order_adjustment_append_only`, `order_status_change_append_only`; hand-written tail of the generated file); the down script drops tables in reverse order, then the functions, and removes the bookkeeping row. It never touches 0003 data.
- `meta/_journal.json`, `meta/*_snapshot.json` - drizzle-kit bookkeeping; generated, never edited by hand.
- `drizzle.config.ts` (in `apps/api/`) - drizzle-kit config; schema from `src/database/schema/index.ts`. `pnpm --filter @fluxkit/api db:generate` creates a migration; `db:drift` checks that the schema and migrations agree.

## Seed (`src/seed/`)

- `seed.ts` - entry of `pnpm seed` (built output run by Node); exit code.
- `seed-command.ts` - production guard (refuses `NODE_ENV=production` without `--allow-production`), standalone Nest context, summary and error output.
- `catalog-seeder.ts` - `CatalogSeeder`: creates `@fluxkit/seeds` data through the admin services; idempotent, never updates or deletes. Must not write to the database except through the admin services.
  Publishing needs a shop-currency price, so before publishing it writes the demo price of every variant (from the seed data, matched by option values, stored in `SHOP_CURRENCY`) through `PricesService`, sets `allowBackorder` through `VariantsService`, and receives the demo stock through `InventoryService.adjust` with a `null` actor (a `receipt` movement, reason "Demo seed", default location). A tracked variant with stock 0 gets no level row.
- `seed.spec.ts` - runs the seeder on real Postgres and reads the result through the store API (prices, compare-at, every availability state) and the admin inventory routes (levels, journal without an actor); a second run adds no row to any table.

## Test support (`src/test/`)

- `app.ts` - `startApp` (listening test app; `storeCookieSecure`, `customerSessionIdleMinutes` and `customerSessionMaxHours` configure customer sessions): default test authenticator signs in as an owner (`adminPrincipal: { role }` for another role), `"production-default"` runs the real session authenticator, plus a controlled `clock`, `extraFeatures` (probe controllers) and cheap scrypt parameters.
- `allow-all-admin-authenticator.ts` - TEST ONLY: signs every admin request in as one fixed user (owner by default) and `testPrincipal`. Never import outside `src/test` or specs.
- `fake-clock.ts` - TEST ONLY: a `Clock` the test moves by hand.
- `admin-user-fixtures.ts` - TEST ONLY: inserts and deletes admin users directly; with `password` the hash is real, so the user can log in.
- `auth-http.ts` - TEST ONLY: `login`, `loginCookie` and `sessionCookieOf` for specs that sign in through the real endpoint.
- `routes.ts` - `registeredRoutes` / `adminRoutes`: every route of the real Express router, with params filled in, for route-walking specs.
- `store-routes.ts` - TEST ONLY: `storeRoutes` lists the `/store` routes of the real router with whether each is marked `@CustomerAuthenticated()` (read from the controllers' metadata; an unmatched route fails loudly).
- `customer-probe.ts` - TEST ONLY, excluded from the build: probe controllers (customer-authenticated, public, rate-limited, sign-in and sign-out stand-ins) registered through `extraFeatures`, and a route under `/store/account` that forgot the decorator, for the route-walk test.
- `customer-fixtures.ts` - TEST ONLY: inserts and deletes customers directly (placeholder hash, or a real one with `password`, so the customer can sign in).
- `customer-http.ts` - TEST ONLY: `customerLogin`, `customerLoginCookie`, `customerCookieOf` and `customerSetCookieOf` for specs that sign in through the real endpoint.
- `env.ts` - `requireEnv` and `requireTestDatabaseUrl` (fail, never skip, when a service variable or a non-`_test` database is used).
- `scratch-database.ts` - TEST ONLY: `createScratchDatabase()` creates (and drops) an empty `fluxkit_mig_<random>_test` database beside the test database, for specs that need "nothing migrated" without wiping the shared one.
- `migrate.ts` - `ensureMigrated()`: brings the test database to exactly the migrations in `drizzle/meta/_journal.json`.
- `http.ts` - `http()` helper for specs (parsed JSON, `undefined` for 204); sends `X-Fluxkit-CSRF: 1` and a JSON content type by default, with `csrf: false` / `contentType` / `headers` to override.
- `pricing-fixtures.ts` - TEST ONLY: `priceProductVariants` gives every variant of a product a shop-currency price straight in the table, so specs of other features can publish products without using the price endpoints; `startApp({ shopCurrency })` runs the app with another shop currency.
- `inventory-fixtures.ts` - TEST ONLY: a real admin user row and an authenticator for it (the default test principal is not a row, and `stock_movement.actor_id` is a foreign key), the default and extra locations, level and journal readers, `expectJournalReplays`, `expectWaitsForLevelLock` and `expectWaitsForVariantLock`.
- `stock-world.ts` - TEST ONLY: `StockWorld` builds published, priced, stocked variants through the admin API; `expectLevelInvariants` checks `reserved` against the active reservations.
- `catalog-fixtures.ts` - catalog fixtures through the real admin routes, `expectVariantInvariants`, and the product-lock wait check.
- `fixtures/features/sample/` - sample feature package used by the core feature-loader tests.

## Features, health and spikes

- `src/features/feature-loader.ts` - discovers feature packages by manifest and imports enabled ones (`FEATURES_ENABLED`) dynamically. `feature-loader.spec.ts`, `feature-flags.spec.ts` test it.
- `src/health/` - `GET /health` (`health.controller.ts`, `health.module.ts`, `health.spec.ts`).
- `src/spikes/queue.spec.ts` - BullMQ spike against real Redis.
- `src/spikes/search.spec.ts` - Meilisearch spike (Ukrainian text, variant filters, facets); findings in `docs/adr/0005-search-notes.md`.
- `vitest.config.ts` - Vitest with SWC (needed for Nest decorator metadata); spec files run one at a time (`fileParallelism: false`).
