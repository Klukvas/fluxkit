# apps/api

- `src/main.ts` - bootstrap: load env, create app, serve Swagger UI at `/docs`, listen.
- `src/index.ts` - placeholder entry (`export {}`); no public exports yet.
- `src/app.factory.ts` - `createApp` (loads features, passes the admin session settings, builds Nest app, shutdown hooks) and `buildOpenApiDocument`; used by main, tests, export.
- `src/app.module.ts` - root module; composes database, auth, common, health, catalog and dynamically loaded feature modules. Must not import features statically.
- `src/openapi-export.ts` - writes `docs/api/openapi.json` (run via `pnpm openapi:export`); never contacts the database.
- `src/openapi.spec.ts` - fails when the committed `openapi.json` is stale.

## Common (`src/common/`)

- `common.module.ts` - global module: the problem filter for every route and the locale configuration (`LOCALE_CONFIG`).
- `locale.ts` - `LOCALE_CONFIG` token and `LocaleConfig` (`defaultLocale`, `locales`), fed from `DEFAULT_LOCALE` and `LOCALES`.
- `problem.ts` - error codes (`PROBLEM_CODES`), status and title maps, `ProblemException` and factories (`validationFailed`, `notFound`, `conflict`, `inUse`, `invalidTransition`, `ruleViolation`, `unauthorized`, `forbidden`). Must not carry SQL or internals.
- `problem.filter.ts` - the one `application/problem+json` writer: known problems pass through, framework 4xx get generic details, unknown errors are logged (method and path only) and answered as `internal_error`.
- `postgres-errors.ts` - maps SQLSTATE and constraint names to problems (`23505` to `conflict` with `field`, `23503` to `in_use` or `invalid_reference`, `23514` to `validation_failed`). Never maps by message text.
- `zod-validation.pipe.ts` - validates `@Body`, `@Query`, `@Param` with zod and turns issues into `errors[]` (`required`, `unknown_field`, ...); `uuidParam` for id parameters.
- `pagination.ts` - admin `?limit` (default 50, max 100) and `?offset` (max 10 000) schema, `Page<T>`, `toPage`, `pageSchema` for OpenAPI.
- `openapi.ts` - OpenAPI helpers: `ApiZodBody`, `ApiZodResponse` (schema from the same zod schema as the validation), `ApiPaginationQuery`, `ApiProblemResponses` and the problem document models.
- `openapi-formats.ts` - response-only schemas (`uuidSchema`, `timestampSchema`) with OpenAPI formats.
- `transaction.ts` - `withTransaction` and the `DbExecutor` / `Transaction` types used by repositories and services.
- `*.spec.ts` - unit tests for the filter, pipe, pagination, Postgres error mapping and transaction helper.

## Auth (`src/auth/`)

- `admin-authenticator.ts` - `AdminAuthenticator` contract (`authenticate(request)` returns an `AdminPrincipal` or `undefined`) and the `AdminPrincipal` type. No environment switch, no API key.
- `session-admin-authenticator.ts` - the production authenticator: session cookie -> `SessionService.resolve` -> principal with the role's permissions. Rethrows internal failures (500), never turns them into access.
- `session.service.ts` - sessions: `create` (32-byte random token, only its SHA-256 stored), `resolve` (core `evaluateSession`, active user, role read from the database every call, `last_seen_at` touched at most once a minute, expired sessions deleted), `revoke`, `revokeAllForUser`. Never logs tokens.
- `session.repository.ts` - Drizzle queries on `admin_session` joined to `admin_user`. Tables only, no rules.
- `session-cookie.ts` - cookie name, safe `Cookie` header parsing (first valid occurrence), `setSessionCookie` / `clearSessionCookie` with the fixed flags. Must not hold session rules.
- `password-hasher.ts` - `PasswordHasher`: `node:crypto` scrypt (asynchronous), self-describing `scrypt$N$r$p$salt$hash`, `verify` (timing-safe, false on malformed input), `needsRehash`, `verifyDummy`.
- `clock.ts` - `Clock` and `SystemClock`, injected so tests control time.
- `auth-config.ts` - `AdminAuthConfig` (cookie `Secure`, idle minutes, maximum hours) and its secure defaults.
- `admin.guard.ts` - `AdminGuard`: CSRF check, public short circuit, authentication (401), permission (403), once per request; `AdminPathGuard`: the global guard for every path under `/admin`.
- `csrf.ts` - `assertCsrfSafe`: the `X-Fluxkit-CSRF: 1` header and JSON content type for state-changing methods.
- `route-access.ts` - `@RequirePermission`, `@PublicAdminRoute`, `UseDefaultPermissionByMethod` and `resolveRouteAccess` (route, then controller, then the default by HTTP method). Must not hold role tables: those are in `@fluxkit/core`.
- `current-admin.ts` - `@CurrentAdmin()` parameter decorator; the principal lives in a `WeakMap` keyed by the request.
- `admin-controller.decorator.ts` - `@AdminController(resource)`: `/admin/<resource>` with the guard, the default permission by method, the Swagger tag, and the 401, 403 and 500 problem responses. Use it for every admin controller.
- `auth.module.ts` - global `AuthModule.register(options)`: config, clock, hasher, session service, the authenticator (session-based unless a test replaces it) and the guards.
- `*.spec.ts` - hasher, cookie, CSRF, session service (real Postgres), guard unit tests; `admin-default-deny.spec.ts` (401 on every route, probe controllers), `admin-permissions.spec.ts` (route walk, role matrix), `admin-csrf.spec.ts` (CSRF and no-CORS), `session-authentication.spec.ts` (cookie end to end), `auth-consistency.spec.ts` (`ROLES` vs the database CHECK, config defaults vs core).

## Catalog (`src/catalog/`)

- `catalog.module.ts` - core catalog module (no feature flag); imports every admin resource module and `StoreModule`.
- `shared/attribute-usage.ts` - "is this attribute in use" facts for the core change rules (JSONB keys in `product` and `variant`). Must not decide the rules itself.
- `shared/code-schemas.ts` - zod schemas for codes (`code`, value code) and the limits they use.
- `shared/i18n-validation.ts` - zod schema for i18n texts that calls core `validateI18nText` with the configured locales.
- `shared/rules.ts` - `assertAllowed`: turns a rejected core decision into `409 rule_violation` with the core reason as `rule`.
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
- `product-options/` - `PUT /admin/products/{id}/options` and `POST .../options/{optionId}/values`; draft-only replacement, frozen options after publish.
- `variants/` - `/admin/products/{id}/variants` (list, create, get, patch, delete) and `POST .../variants/generate`; `variant-generation.service.ts` runs core `generateVariants` and retries proposed SKU collisions (never client-sent SKUs).

### Store (`src/catalog/store/`)

- `store.module.ts` - `StoreModule`: public controllers and read-only repository.
- `store-controller.decorator.ts` - `@StoreController(resource)`: `/store/<resource>`, no guard, read-only, the `store` Swagger tag.
- `store-categories.controller.ts` - `GET /store/categories`.
- `store-products.controller.ts` - `GET /store/products` and `GET /store/products/{slug}`.
- `store.schemas.ts` - query and response shapes of the store API; the page size default (24) lives here.
- `store.service.ts` - store rules: locale resolution (400 on unknown), active-only visibility, category subtree filter, image choice, order. Must not return internal attributes.
- `store.serializer.ts` - the one place that emits attribute values and definitions to clients, via core `selectPublicAttributes` and `publicAttributeDefinitions`; `requiredText` logs and degrades to `""` when a required text has no locale.
- `store-categories.ts` - builds the visible category tree (every ancestor active) and the subtree of a slug.
- `store.repository.ts` - read-only Drizzle queries (batch loads, no N+1). Must not apply business rules beyond SQL filters (`status`, `is_active`).
- `store.spec.ts` - HTTP tests: visibility, leaks of internal attributes, locale, pagination bounds, query counts.

## Database (`src/database/`)

- `database.module.ts` - global Postgres pool and Drizzle provider; closes the pool on shutdown.
- `schema/index.ts` - schema barrel used by Drizzle and by the error mapper.
- `schema/health.ts` - `health_check` table (health probe).
- `schema/catalog.ts` - the 16 catalog tables (ADR 0006 section 2) with constraints and indexes.
- `schema/admin-auth.ts` - `admin_user` and `admin_session` tables (admin login; sessions store only a SHA-256 token hash, no IP address or user agent).
- `catalog-schema.spec.ts` - constraint tests on real Postgres (inside rolled-back transactions).
- `admin-auth-schema.spec.ts` - constraint, cascade and name tests for the admin auth tables.
- `migrations.spec.ts` - migrations up, down, up, down on a `*_test` database; refuses other database names.

## Migrations (`drizzle/`)

- `0000_health_check.sql` and `0000_health_check.down.sql` - the scaffold's health table.
- `0001_catalog.sql` and `0001_catalog.down.sql` - the 16 catalog tables; the down script drops them in reverse order and removes the migration's bookkeeping row.
- `0002_admin_auth.sql` and `0002_admin_auth.down.sql` - `admin_user` and `admin_session`; the down script drops them (sessions first) and removes the bookkeeping row.
- `meta/_journal.json`, `meta/*_snapshot.json` - drizzle-kit bookkeeping; generated, never edited by hand.
- `drizzle.config.ts` (in `apps/api/`) - drizzle-kit config; schema from `src/database/schema/index.ts`. `pnpm --filter @fluxkit/api db:generate` creates a migration; `db:drift` checks that the schema and migrations agree.

## Seed (`src/seed/`)

- `seed.ts` - entry of `pnpm seed` (built output run by Node); exit code.
- `seed-command.ts` - production guard (refuses `NODE_ENV=production` without `--allow-production`), standalone Nest context, summary and error output.
- `catalog-seeder.ts` - `CatalogSeeder`: creates `@fluxkit/seeds` data through the admin services; idempotent, never updates or deletes. Must not write to the database except through the admin services.
- `seed.spec.ts` - runs the seeder on real Postgres and reads the result through the store API.

## Test support (`src/test/`)

- `app.ts` - `startApp` (listening test app): default test authenticator signs in as an owner (`adminPrincipal: { role }` for another role), `"production-default"` runs the real session authenticator, plus a controlled `clock`, `extraFeatures` (probe controllers) and cheap scrypt parameters.
- `allow-all-admin-authenticator.ts` - TEST ONLY: signs every admin request in as one fixed user (owner by default) and `testPrincipal`. Never import outside `src/test` or specs.
- `fake-clock.ts` - TEST ONLY: a `Clock` the test moves by hand.
- `admin-user-fixtures.ts` - TEST ONLY: inserts and deletes admin users directly (no user endpoint yet).
- `routes.ts` - `registeredRoutes` / `adminRoutes`: every route of the real Express router, with params filled in, for route-walking specs.
- `env.ts` - `requireEnv` and `requireTestDatabaseUrl` (fail, never skip, when a service variable or a non-`_test` database is used).
- `migrate.ts` - `ensureMigrated()`: brings the test database to exactly the migrations in `drizzle/meta/_journal.json`.
- `http.ts` - `http()` helper for specs (parsed JSON, `undefined` for 204); sends `X-Fluxkit-CSRF: 1` and a JSON content type by default, with `csrf: false` / `contentType` / `headers` to override.
- `catalog-fixtures.ts` - catalog fixtures through the real admin routes, `expectVariantInvariants`, and the product-lock wait check.
- `fixtures/features/sample/` - sample feature package used by the core feature-loader tests.

## Features, health and spikes

- `src/features/feature-loader.ts` - discovers feature packages by manifest and imports enabled ones (`FEATURES_ENABLED`) dynamically. `feature-loader.spec.ts`, `feature-flags.spec.ts` test it.
- `src/health/` - `GET /health` (`health.controller.ts`, `health.module.ts`, `health.spec.ts`).
- `src/spikes/queue.spec.ts` - BullMQ spike against real Redis.
- `src/spikes/search.spec.ts` - Meilisearch spike (Ukrainian text, variant filters, facets); findings in `docs/adr/0005-search-notes.md`.
- `vitest.config.ts` - Vitest with SWC (needed for Nest decorator metadata); spec files run one at a time (`fileParallelism: false`).
