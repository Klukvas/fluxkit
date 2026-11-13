# packages/features

- `README.md` - rules for feature packages.
- `_example/` - sample feature `example` (`GET /example/ping`), with its own test. Template and intended fixture for the planned CI feature matrix (plan step 8); safe to delete.

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
