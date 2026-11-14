# packages/features

Optional feature modules, one package per feature (`packages/features/<name>`), each toggled by one flag.
Core must never import from here. See `AGENTS.md` sections 2.1 and 18.

A feature reaches the API only through `@fluxkit/api-kit` (problems, admin permissions, the database, media and locale tokens) and
`@fluxkit/core`; a feature with tables ships its own `drizzle/` journal and exports `personalDataInventory` (ADR 0049, contract
`docs/contracts/README.md`, "Feature extension points"; the core specs use the fixture `apps/api/src/test/fixtures/features/notebook`).
