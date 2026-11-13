# @fluxkit/api-kit

What a feature package may use from the API (ADR 0049; contract: `docs/contracts/README.md`, "Feature extension points"):
`ProblemException`, `RequirePermission`, `AdminController` and the tokens `FEATURE_DATABASE`, `MEDIA_PORT`, `LOCALE_CONFIG`. Depends on
`@nestjs/common` (a runtime dependency at the API's version, with its peers `reflect-metadata` and `rxjs`, so the production install has it) and `@fluxkit/core` only. File map: `docs/files/features.md`.

- `.` (public entry) - the minimum set above. A contract: breaking it is a major release.
- `./internal` - for `apps/api` only (problem tables, metadata keys, `PublicAdminRoute`, `AuthenticatedAdminRoute`,
  `UseDefaultPermissionByMethod`). Not a contract; a feature must not import it.

The code moved here unchanged from `apps/api` (re-exported from its old paths there). The API's own `AdminController` adds the guard
class, the Swagger tag and the problem responses on top of this one; feature routes are guarded by the API's global `AdminPathGuard`.
