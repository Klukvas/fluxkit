# Fluxkit

White-label e-commerce template: a solid catalog/cart/checkout core, replaceable design, and feature modules you can switch on or off per client.
Sold as a template plus a team that adapts design and features for each client.

**Powered by [FluxLab](https://flux-lab.dev/en)**

## Principles

- **Niche-agnostic catalog**: Product + Variant (SKU), data-driven attributes via ProductType (not built yet, designed in ADR 0004).
- **Replaceable design**: design tokens (`packages/theme`) and a token-based UI library (`packages/ui`); redesign = change tokens, not components.
- **Modular features**: every optional feature is its own package behind one flag; core never imports features (enforced in CI).
- **Honest checks**: no stubbed scripts, no skipped integration tests, no cached test passes.

## Status

Scaffold complete (plan `docs/plans/2026-10-14-monorepo-scaffold.md`): monorepo, tooling, CI, API spike, search spike, storefront and admin skeletons.
**There is no business logic yet**: no catalog, cart, checkout, orders or customers. What exists and works:

- API: `GET /health`, Swagger UI at `/docs`, OpenAPI export, feature loader (sample feature `example`), Drizzle migration spike, BullMQ and Meilisearch spikes.
- Storefront (`/uk`, `/en`) and admin: placeholder pages built from the shared UI and tokens (light and dark themes).
- CI on GitHub Actions: lint, types, boundaries, tests on real Postgres 17 / Redis 8 / Meilisearch, feature on/off/deleted matrix, license and audit policy, docs-with-code check, Compose smoke test.

Open decisions and next steps are listed at the end.

## Quick start

Prerequisites: Node 22 (`.nvmrc`), pnpm 10.28 (`corepack enable`), Docker with Compose.

```bash
pnpm install
cp .env.example .env     # edit values; never commit .env

# Postgres, Redis, Meilisearch
docker compose --env-file .env -f infra/docker-compose.yml up -d --wait

# Tests drop schema objects, so they need a separate database whose name ends in _test
docker compose --env-file .env -f infra/docker-compose.yml exec postgres createdb -U fluxkit fluxkit_test

pnpm build
pnpm --filter @fluxkit/api start        # API on PORT (default 3000); try /health and /docs
pnpm --filter @fluxkit/storefront dev   # http://localhost:3000 (set another port if the API uses 3000)
pnpm --filter @fluxkit/admin dev
```

Run the full test suite (integration tests need real services and fail, not skip, without these variables; use the passwords from your `.env`):

```bash
export DATABASE_URL=postgres://fluxkit:<POSTGRES_PASSWORD>@127.0.0.1:5432/fluxkit_test
export REDIS_URL=redis://:<REDIS_PASSWORD>@127.0.0.1:6379
export MEILI_URL=http://127.0.0.1:7700 MEILI_MASTER_KEY=<MEILI_MASTER_KEY>
pnpm test
```

Enable optional features with `FEATURES_ENABLED=example` (comma-separated) in `.env`; see `docs/contracts/config.md`.

## Scripts (root)

| Script | What it does |
|---|---|
| `pnpm build` / `pnpm typecheck` | Turborepo build and type check of every package |
| `pnpm lint` / `pnpm format:check` (`pnpm format`) | ESLint (bans `any`, `@ts-ignore`, empty `catch`) / Prettier |
| `pnpm check:boundaries` | module boundary rules (core must not import features, etc.); fails if nothing was checked |
| `pnpm test` | builds, then runs Vitest in every package (needs the services above) |
| `pnpm openapi:export` | regenerates `docs/api/openapi.json` (a test fails when it is stale) |
| `pnpm check:licenses` / `pnpm audit:prod` / `pnpm notices` | license policy, production audit, third-party notices file |
| `pnpm check:docs` | docs-with-code rules against `origin/main` |
| `pnpm feature-matrix on\|off\|deleted` | feature enable/disable/delete verification (`deleted` removes files, CI only) |

## Repository layout

```
apps/api            NestJS API (REST + OpenAPI)
apps/storefront     Next.js storefront (App Router, Tailwind, tokens, uk/en)
apps/admin          React + Vite admin
packages/core       domain logic (empty scaffold)
packages/features   optional feature modules (sample: _example)
packages/providers  payment and shipping provider plugins (none yet)
packages/ui         token-based components and i18n helpers
packages/theme      design tokens and their guard tests
packages/config     env and feature flag parsing
packages/api-client typed API client (empty scaffold)
infra/              Docker Compose for Postgres, Redis, Meilisearch
scripts/            CI and policy scripts
docs/               architecture decisions, contracts, API and file maps, plans
```

## Documentation map

- `AGENTS.md`: rules for all contributors and AI agents (architecture, workflow, security, CI). `CLAUDE.md` imports it.
- `docs/adr/`: decisions: 0001 own core, 0002 stack, 0003 tooling, 0004 data model, 0005 search notes.
- `docs/contracts/`: public contracts under SemVer (config and feature flags, design tokens, API).
- `docs/api/`: endpoint notes and `openapi.json`. `docs/files/`: what each file and package is responsible for.
- `docs/dependencies.md`: licenses and decisions. `docs/plans/`: task plans. `docs/AGENT_WORKFLOW.md`: roles, models and decisions log.

## Working with AI agents

Rules and roles are in `AGENTS.md` and `docs/AGENT_WORKFLOW.md`: plan first, check for existing functionality, never mask failures, stop and ask in the red zones
(dependencies, migrations, public contracts, payments/auth, destructive actions), and have a different agent review every change.

## Licenses

Code dependencies follow the policy in `AGENTS.md` section 16 (`scripts/license-policy.json`). Redis 8 (AGPLv3) runs as an unmodified external service with legal sign-off.
Generate the third-party notices to ship with a delivery with `pnpm notices` (also produced by CI).

## Open decisions and next steps

1. Ukrainian search morphology and variant-level facet counts (`docs/adr/0005-search-notes.md`).
2. Core domain implementation in `packages/core` and `apps/api`: catalog (ProductType, attributes, variants), pricing pipeline, inventory, cart, checkout, orders (TDD for all money logic).
3. Payment and shipping provider interfaces and the first Ukrainian providers (LiqPay, WayForPay, Monobank, Nova Poshta).
4. Production: API/worker images, gate Swagger UI, Playwright e2e, branch protection on `main` with the CI checks required, pin GitHub Actions by commit SHA.
