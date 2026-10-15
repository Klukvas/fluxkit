# Contract: public HTTP API

Status: the catalog surface (`/admin/*`, `/store/*`) is public in the code but not released yet; no SemVer release has been made, so the contract can still change before the first one (recorded in `CHANGELOG.md`).
Source of truth: `docs/api/openapi.json` (generated, `pnpm openapi:export`). Readable map of every route and its errors: `docs/api/catalog.md`. Per-module notes: `docs/api/`.
Breaking changes follow AGENTS.md section 17: major version, migration guide in `docs/migrations/`, `CHANGELOG.md` entry; deprecate first when possible.

## What is contract

| Surface | Contract | Notes |
|---|---|---|
| `GET /health` | yes | liveness and database reachability (`docs/api/health.md`) |
| `GET /store/categories`, `GET /store/products`, `GET /store/products/{slug}` | yes | every response shape, every query parameter, the locale rules, the visibility rules (see `docs/api/catalog.md`, Store) |
| `/admin/*` routes | yes, as of this release | every route, request and response shape, status code and problem code listed in `docs/api/catalog.md`. Admin answers `401` to everyone until the auth plan; that default is part of the contract until auth lands |
| Default deny for `/admin` | yes | A global guard (`AdminPathGuard`, `APP_GUARD`) protects EVERY route whose path starts with `/admin` (matched case-insensitively, trailing slash included), whether or not its controller uses `@AdminController`. This covers routes added by feature modules: a feature may declare a plain `@Controller("admin/<name>")` and it is still `401` for everyone the authenticator denies. The authenticator is asked once per request. An oversized JSON body (over 100 KB) is rejected with `413` before any guard runs, also on `/admin/*`; malformed JSON answers `400`; both are `application/problem+json` and not logged as errors |
| Error model | yes | `application/problem+json` with the `code` values and status mapping in `docs/api/catalog.md` (Conventions). New codes are additive (minor); removing or renaming one is breaking |
| Pagination | yes | `?limit` and `?offset` bounds and the `{items, total, limit, offset}` shape |
| Locale handling | yes | `?locale=` against the configured `LOCALES`; missing means `DEFAULT_LOCALE`; per-field fallback |

Adding an optional request field, a response field, a route, or a new problem `code` is a minor change. Removing or renaming any of them, changing a type, or tightening a validation rule is breaking.

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
- Routes and fields that are documented as not yet implemented (for example prices, inventory, search, cart) are not in this contract; they arrive with their own plans.

## Versioning

- SemVer for the template (`AGENTS.md` section 17). Routes live under `/admin` and `/store` without a version segment; a breaking change to a route means a new major version of the template and a migration guide, not a silent edit.
- Before the first release the contract may still change; the change is still recorded in `CHANGELOG.md`.
