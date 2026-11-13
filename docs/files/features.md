# packages/features

- `README.md` - rules for feature packages.
- `_example/` - sample feature `example` (`GET /example/ping`), with its own test. Template and intended fixture for the planned CI feature matrix (plan step 8); safe to delete.
- `blog/` - feature `blog` (`@fluxkit/feature-blog`, plan `docs/plans/2026-11-13-blog.md`, routes `docs/api/features-blog.md`). Reaches the
  API through `@fluxkit/api-kit` and core only; must not import `apps/*` or another feature.
  - `src/index.ts` - entry: `featureModule` (the Nest module) and `personalDataInventory`.
  - `src/schema.ts` - the Drizzle table `blog_post` (the only file of the package allowed to declare tables). Must not reference core
    tables (the foreign key to `media_upload` is added by hand in the migration).
  - `drizzle/` - the feature's journal: `0000_blog_post.sql` (with the hand-added foreign key), `0000_blog_post.down.sql` (run by hand
    before deleting the feature), `meta/`. `drizzle.config.ts` - drizzle-kit config for it (also read by the drift check).
  - `src/rules.ts` - pure rules: limits, the public-post predicate, the admin state, the publish rule, page offsets. No I/O.
  - `src/content.ts` - content checks with core rules (locale maps, slug, Markdown bodies) returning field errors. Must not touch the database.
  - `src/schemas.ts` - zod request schemas (structure and static limits only).
  - `src/problems.ts` - the problems the blog raises (`ProblemException` of the kit), zod issues to field errors, the unique-violation check.
  - `src/blog.repository.ts` - queries on `blog_post` only (uploads go through `MEDIA_PORT`).
  - `src/admin-blog.service.ts`, `src/admin-blog.controller.ts` - `/admin/blog/posts`: drafts, edits, publish, unpublish, delete.
  - `src/store-blog.service.ts`, `src/store-blog.controller.ts` - `/store/blog`: public posts and fields only, the body parsed again on
    every read.
  - `src/responses.ts` - response shapes and the "own locale text" rule. `src/inventory.ts` - `personalDataInventory` (every column `none`).
  - `src/*.spec.ts` - rules (TDD), inventory, declared permissions, migration up/down/up/down, admin and store routes over HTTP on a
    scratch Postgres database. `src/test/` - TEST ONLY helpers: scratch database, a `MEDIA_PORT` stand-in, the test app with a problem
    filter stand-in; excluded from the build.

# packages/api-kit

`@fluxkit/api-kit` (ADR 0049): the API building blocks a feature package may use (contract: `docs/contracts/README.md`, "Feature extension
points"). Depends on `@nestjs/common` (peer) and `@fluxkit/core` only. No I/O.

- `src/index.ts` - public entry, the minimum set: `ProblemException` (+ `ProblemCode`, `ProblemInit`, `FieldError`, `ProblemExtensions`),
  `RequirePermission`, `AdminController` (+ `DefaultPermissions`), `FEATURE_DATABASE`, `MEDIA_PORT`, `LOCALE_CONFIG` (+ `LocaleConfig`).
  Must not export anything else (`route-access.spec.ts` pins the list).
- `src/internal.ts` - `@fluxkit/api-kit/internal`, for `apps/api` only: the problem tables, the four metadata keys, `PublicAdminRoute`,
  `AuthenticatedAdminRoute`, `UseDefaultPermissionByMethod`, `CATALOG_DEFAULT_PERMISSIONS`. Not a contract; features must not import it.
- `src/problem.ts` - problem codes, status and title tables, `FieldError`, `ProblemInit`, `ProblemException` (moved unchanged from
  `apps/api/src/common/problem.ts`). Must not shape a response body (the API's problem filter does).
- `src/route-access.ts` - the admin route metadata keys (never change) and the decorators writing them, the default permission pair. Must not
  resolve or check access (`apps/api/src/auth/route-access.ts` and the guard do).
- `src/admin-controller.ts` - `AdminController(resource, defaults?)`: prefix and default-permission metadata. Must not add guards or Swagger
  metadata (the API's own `AdminController` does).
- `src/tokens.ts` - `FEATURE_DATABASE`, `MEDIA_PORT`, `LOCALE_CONFIG`, `LocaleConfig`. Must not provide values (the API's modules do).
- `src/route-access.spec.ts` - the four key strings, the decorators' metadata, both export sets. `src/dependencies.spec.ts` - imports and
  manifest limited to `@nestjs/common` and `@fluxkit/core`.
