# packages/features

Optional feature modules, one package per feature (`packages/features/<name>`), each toggled by one flag.
Core must never import from here. See `AGENTS.md` sections 2.1 and 18.

A feature reaches the API only through `@fluxkit/api-kit` (problems, admin permissions, the database, media and locale tokens) and
`@fluxkit/core`; a feature with tables ships its own `drizzle/` journal and exports `personalDataInventory` (ADR 0049, contract
`docs/contracts/README.md`, "Feature extension points"; the core specs use the fixture `apps/api/src/test/fixtures/features/notebook`).

A package the feature imports at run time (`@nestjs/common` with its peers `reflect-metadata` and `rxjs`, at the API's versions, like
`@fluxkit/api-kit`) is a `dependency`, never only a peer or dev dependency: the production API image installs with `--prod`, which links
no peer of a workspace package, so the API would fail to load the enabled feature (`scripts/deploy-smoke.sh` switches the blog on in
that image). The same holds for `_example` and every provider package; the guard is
`apps/api/src/common/workspace-runtime-dependencies.spec.ts`.
