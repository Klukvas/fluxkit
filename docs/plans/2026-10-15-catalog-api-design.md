# Catalog admin API: design for step 4

Status: spec for the developer agents of plan step 4 (`docs/plans/2026-10-14-catalog.md`). Builds on ADR 0006 and `packages/core/src/catalog`.
The first public version of these endpoints becomes a contract (`docs/contracts/api.md`, step 7). Names below are final unless a developer finds a real conflict (then: stop, report).

## Conventions (all admin endpoints)

- Prefix `/admin`. Every route is protected by `AdminGuard` (default deny). With no authentication provider the guard answers `401` for every request. Tests inject an allow-all authenticator; production has none until the auth plan.
- JSON only. Field names camelCase. IDs are UUIDs. Timestamps are ISO 8601 strings (UTC). i18n texts are maps `{"uk": "...", "en": "..."}` (full maps in the admin API).
- Errors use `application/problem+json` (RFC 9457 shape): `{ "type": "about:blank", "title": "...", "status": 400, "code": "validation_failed", "detail": "...", "errors": [{ "path": "attributes.size", "code": "required" }] }`.
  Codes: `validation_failed` (400), `unauthorized` (401), `not_found` (404), `conflict` (409, with `field` or `constraint` hint when known), `in_use` (409, a RESTRICT foreign key or a core "in use" rule), `invalid_transition` (409), `rule_violation` (409, a core rule such as a forbidden ProductType change; `rule` carries the core reason code), `internal_error` (500, no internals leaked).
  Core validation results (`validateAttributeValues`, `validateI18nText`, `generateVariants`, `publishPreconditions`, ...) map to `400 validation_failed` with one `errors[]` entry per core error (`path` + `code` = the core reason). Unique violations (SQLSTATE 23505) map to `409 conflict`; foreign key RESTRICT violations (23503) to `409 in_use`; map by the constraint names declared in the Drizzle schema, never by message text.
- Lists: `?limit` (default 50, max 100) and `?offset` (max 10 000); response `{ "items": [...], "total": n, "limit": n, "offset": n }`. Stable order: `position`, then `code`/`slug`/`id`.
- Updates are `PATCH` with a partial JSON body (only listed fields change, unknown fields are rejected with 400). No `PUT` for whole resources. Creation answers `201` with the full resource and a `Location` header; deletes answer `204`.
- Request bodies are validated with Zod schemas (zod 4 is already a dependency of `apps/api` through `@fluxkit/config`; add it to `apps/api` explicitly if missing, it is already approved). The same schemas feed OpenAPI via `z.toJSONSchema` (no new dependency).
- Locales: `DEFAULT_LOCALE` (default `uk`) and `LOCALES` (default `uk,en`, must contain the default) come from `@fluxkit/config`; texts are validated with the core `validateI18nText` using them.
- Database access uses the Drizzle query builder (so `updated_at` `$onUpdate` works), inside a transaction for every write that touches more than one row. Read-modify-write rules from core run INSIDE the transaction. Category moves take `pg_advisory_xact_lock` (one constant key for the tree). Slug and SKU collisions: ask core for a candidate, insert, and retry with the next suffix on 23505 (bounded retries), instead of locking.
- Codes are immutable after creation (`PATCH` rejects `code`), see ADR 0006 section 5; the ProductType and attribute change rules come from `packages/core` `decide*` functions fed with facts read from the database ("values exist", "used by products", ...).
- Module layout: `apps/api/src/catalog/admin/<resource>/` with `*.controller.ts`, `*.service.ts`, `*.schemas.ts` (Zod), `*.mapper.ts` (row to API shape), `*.spec.ts` (HTTP-level integration tests against real Postgres). Shared pieces in `apps/api/src/common/` (problem filter, Zod pipe, pagination, transaction helper) and `apps/api/src/auth/` (AdminGuard). Core imports only from `@fluxkit/core`.

## Resources and endpoints

Resource shapes mirror the DB columns of ADR 0006 in camelCase, plus `id`, `createdAt`, `updatedAt`; nested collections are named in the table.

| Resource | Endpoints |
|---|---|
| Attributes | `POST /admin/attributes`, `GET /admin/attributes`, `GET /admin/attributes/:id` (includes `options`), `PATCH /admin/attributes/:id`, `DELETE /admin/attributes/:id`; options: `POST /admin/attributes/:id/options`, `PATCH /admin/attributes/:id/options/:optionId`, `DELETE /admin/attributes/:id/options/:optionId` |
| Options (variant axes) | `POST /admin/options`, `GET /admin/options`, `GET /admin/options/:id` (includes `values`), `PATCH`, `DELETE`; values: `POST /admin/options/:id/values`, `PATCH /admin/options/:id/values/:valueId`, `DELETE /admin/options/:id/values/:valueId` |
| Product types | `POST /admin/product-types`, `GET`, `GET /:id` (includes `attributes` assignments and `options`), `PATCH`, `DELETE`; assignments: `PUT /admin/product-types/:id/attributes/:attributeId` (body `level`, `isRequired`, `position`; creates or updates), `DELETE` the same path; `PUT /admin/product-types/:id/options/:optionId` (body `position`), `DELETE` the same path |
| Brands | `POST /admin/brands`, `GET`, `GET /:id`, `PATCH`, `DELETE` |
| Categories | `POST /admin/categories`, `GET /admin/categories` (flat list, optional `?parentId`), `GET /:id`, `PATCH`, `DELETE`, `POST /admin/categories/:id/move` (body `parentId`, `position`) |
| Products | `POST /admin/products` (creates a draft; a product whose type allows options may be created without options; the service creates the default variant), `GET /admin/products` (`?status`, `?categoryId`, `?brandId`), `GET /admin/products/:id` (includes `options`, `categories`, `variants`, `media`), `PATCH`, `DELETE` (only never-published), `POST /admin/products/:id/publish`, `/unpublish`, `/archive`, `/restore` |
| Product options and categories | `PUT /admin/products/:id/options` (body: list of `{ optionId, valueIds }`; only while `draft`; regenerates variants), `POST /admin/products/:id/options/:optionId/values` (add a value on a non-draft product; generates the new variants), `PUT /admin/products/:id/categories` (body list of `{ categoryId, position }` plus `primaryCategoryId`) |
| Variants | `GET /admin/products/:id/variants`, `POST /admin/products/:id/variants` (draft products), `GET /:variantId`, `PATCH /:variantId`, `DELETE /:variantId` (core rule), `POST /admin/products/:id/variants/generate` |
| Media | `PUT /admin/products/:id/media` (replace the list: `url`, `alt`, `position`, optional `optionId` + `optionValueId`) |

Rules that must come from core, not be re-implemented: attribute value validation (draft writes vs publish), signature computation, variant generation and limits, SKU/slug normalization and proposals, category move validation, lifecycle transitions and publish preconditions, hard-delete rule, ProductType change decisions, i18n validation.

## Out of scope in step 4
Store (public) API (step 5), seeds (step 6), OpenAPI regeneration and written docs (step 7: but every sub-step must keep `pnpm openapi:export` consistent, run it and commit `docs/api/openapi.json` when routes change), authentication itself, prices and stock.

## Testing rules (all sub-steps)
- HTTP-level tests with the real app and real Postgres (`*_test` database, fail not skip). Each resource: happy path, each validation error path, 404, 409 (conflict and in-use), the default-deny guard (without the test authenticator every route returns 401).
- Every state-changing rule from ADR 0006 sections 5 and 6 that the endpoint exposes gets a test through HTTP.
- Tests clean up after themselves or use unique codes; migrations are applied to the test database by the harness (see `apps/api/src/test`).

## Test harness for HTTP integration tests (decided)
The existing specs share one database: `migrations.spec.ts` drops and recreates everything, `catalog-schema.spec.ts` runs inside rolled-back transactions. HTTP tests commit data, so:
- `apps/api/vitest.config.ts` sets `fileParallelism: false` (one spec file at a time; the in-file advisory lock from the schema specs stays as a second safety net).
- A shared helper `ensureMigrated()` (in `apps/api/src/test/`) is called in `beforeAll` of every HTTP spec: if the database does not contain exactly the migrations listed in `drizzle/meta/_journal.json`, it drops the `drizzle` schema and the public tables and applies all migrations. Refuses non-`_test` databases (`requireTestDatabaseUrl`).
- HTTP specs create uniquely named data (random code suffixes) and delete what they created in `afterAll`; they must not depend on another spec's data.
- `startApp()` accepts an authenticator override; the default test app uses an allow-all authenticator, and a dedicated spec per resource group asserts that the real default (deny) answers 401.
