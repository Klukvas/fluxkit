# Plan: monorepo scaffold and stack spike

Status: complete. Steps 1 to 8 merged to `main` (PRs #1 to #5); step 9 (documentation) merged (PR #10). See Outcome at the end.
Role: orchestrator plan; implementation by Developer agents, review by a different agent.

## Goal
Turn ADR 0001-0004 into a runnable, empty-but-working monorepo, and verify the risky stack assumptions
(NestJS + Vitest, Drizzle + Postgres, Meilisearch) before real feature work starts.
Out of scope: any business logic (catalog, pricing, cart, orders), real UI, payment/shipping providers.

## Existing functionality found
- Repo has only docs (`AGENTS.md`, `CLAUDE.md`, `README.md`, `docs/`) and empty folders:
  `apps/{admin,storefront}`, `packages/{config,core,features,theme,ui}`, `seeds`.
- Missing folders from the target layout: `apps/api`, `packages/providers`, `packages/api-client`, `infra`.
- No `package.json`, lockfile, CI, Docker files, or source code. Nothing to reuse or extend.
- Environment: Node v22.22.0, pnpm 10.28.0, Docker CLI 29.8.2 are present. The Docker daemon may not run in this container (to check in step 1).

## Scope
Core (not a feature). Owned paths per agent are listed per step.

### Step 1. Environment and license check (Developer, low risk)
- Check whether the Docker daemon runs here (`docker info`). If not, integration tests that need Postgres/Redis/Meilisearch run in CI only;
  decide fallback (local Postgres binary or CI-only) and record it.
- Verify licenses of: NestJS, Drizzle ORM, drizzle-kit, Next.js, React, Tailwind, Vite, Vitest, Playwright, ESLint, Prettier,
  dependency-cruiser, Turborepo, BullMQ, ioredis, Meilisearch (community edition + JS client), Postgres, Redis (server license!).
- Output: `docs/dependencies.md` table (name, version, license, verdict). Anything outside the allowlist goes back to the user (red zone).
  Special attention: Redis server licensing (changed in recent versions) - consider Valkey as a drop-in if needed (needs approval).
- Owned paths: `docs/dependencies.md`.

### Step 2. Workspace skeleton (Developer)
- Root: `package.json` (private, `packageManager` pinned), `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`,
  `.nvmrc`, `.editorconfig`, `.env.example`, root scripts: `dev`, `build`, `lint`, `typecheck`, `test`, `test:e2e`, `check:boundaries`.
- Create missing folders; each package/app gets `package.json`, `tsconfig.json`, `src/index.ts` (empty export), and a README with its purpose.
- Pin exact versions (lockfile committed).
- Owned paths: repo root config, `packages/*/package.json`, `apps/*/package.json`.

### Step 3. Lint, format, boundaries (Developer)
- ESLint (flat config) with strict TS rules enforcing AGENTS.md section 9: no `any`, no `@ts-ignore`/`@ts-nocheck`, no empty `catch`,
  no unused disable directives.
- Prettier config.
- dependency-cruiser rules: `packages/core` must not import `packages/features/*`; features must not import each other;
  `apps/*` may import packages only through public entry points.
- Verification: add a deliberately violating file in a temp branch/test to prove each rule fails, then remove it (record evidence).
- Owned paths: `eslint.config.*`, `.prettierrc`, `.dependency-cruiser.cjs`.

### Step 4. Infra (Developer)
- `infra/docker-compose.yml`: Postgres, Redis (or Valkey per step 1), Meilisearch, with healthchecks and named volumes.
- `.env.example` entries for all services. No secrets committed.
- One-command start documented: `docker compose -f infra/docker-compose.yml up -d`.
- Owned paths: `infra/`, `.env.example`.

### Step 5. API spike: NestJS + Vitest + Drizzle (Developer, high effort)
- `apps/api`: NestJS app with a `/health` endpoint (checks Postgres connectivity), OpenAPI served at `/docs` and exported to `docs/api/openapi.json`.
- Vitest setup for NestJS (decorator metadata via SWC or esbuild plugin). Unit test and an integration test hitting a real Postgres.
- Drizzle: config, one throwaway migration creating a `health_check` table with up and down, run in the integration test.
- Feature registry stub in `packages/config`: reads `features.<name>.enabled` flags; NestJS dynamic module loads a feature only when enabled.
  One no-op example feature `packages/features/_example` (to prove on/off/deleted CI matrix); documented as a template, removable.
- Success criteria are listed under Verification. If NestJS + Vitest does not work cleanly, STOP and report with options (Jest for api only, or change framework) - do not paper over it.
- Owned paths: `apps/api`, `packages/config`, `packages/features/_example`.

### Step 6. Meilisearch spike (Developer)
- Small script/test in `apps/api` that creates an index, adds documents with Ukrainian text and attributes, and queries with facets and counts.
- Record findings about Ukrainian-language search behavior in `docs/adr/0005-search-notes.md` (typos, word forms, filters). Informational, not production code.
- Owned paths: `apps/api/src/spikes/search`, `docs/adr/0005-search-notes.md`.

### Step 7. Frontends skeleton (Developer)
- `apps/storefront`: Next.js App Router + Tailwind wired to CSS-variable tokens from `packages/theme` (tokens file + one theme preset),
  a single home page rendering a token-styled placeholder component from `packages/ui`.
- `apps/admin`: Vite React app using the same `packages/ui` and tokens, one placeholder page.
- No hardcoded colors or strings: placeholder text goes through a minimal i18n setup (`uk`, `en`).
- Owned paths: `apps/storefront`, `apps/admin`, `packages/ui`, `packages/theme`.

### Step 8. CI (Developer)
- `.github/workflows/ci.yml`: install (frozen lockfile), lint, typecheck, test (with service containers), build, boundary check, dependency audit + license check.
- Feature-removal matrix job: (a) all features on, (b) all optional features off, (c) `packages/features/_example` deleted; core must build and pass tests in each.
- Docs check: fail if `apps/api` routes change without a `docs/api` update (simple script first, can be improved later).
- Owned paths: `.github/`, `scripts/`.

### Step 9. Docs (Docs agent)
- Fill `docs/files/*.md` for every new package/app (one line per significant file), `docs/api/health.md`, `docs/contracts/config.md` (feature flag schema),
  update `AGENTS.md` tooling section with the real scripts and versions, update `README.md` with quick start, add `CHANGELOG.md` entries.
- Owned paths: `docs/`, `README.md`, `AGENTS.md` (tooling section only), `CHANGELOG.md`.

## Order and parallelism
1 -> 2 -> (3, 4 in parallel) -> 5 -> (6, 7 in parallel) -> 8 -> 9.
Steps with disjoint owned paths may run in parallel by different agents. Reviewer (different agent/model) reviews after steps 5 and 8 and at the end.

## Data/API changes
- One throwaway Drizzle migration (`health_check`) with up/down. No production schema yet (domain schema follows ADR 0004 in a later plan).
- API: `GET /health` only. Public contract entry added to `docs/contracts/api.md`.

## Risks
- NestJS decorators + Vitest may need non-trivial config; mitigated by the spike with an explicit stop condition.
- Redis server license may not satisfy the allowlist; mitigation: Valkey (needs approval).
- Docker daemon may be unavailable in the agent container; mitigation: CI service containers as the source of truth for integration tests.
- Version drift: versions pinned from the registry at implementation time; record them in `docs/dependencies.md`.
- Meilisearch Ukrainian search quality unknown; the spike only measures it, no product decision here.
- Over-engineering the scaffold: keep every package minimal, no speculative code.

## Verification (exact, to be run and pasted into the report)
- `pnpm install --frozen-lockfile` succeeds from a clean clone.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm check:boundaries` all pass on the clean tree.
- Boundary check fails on a deliberate `core -> features` import (evidence recorded), and ESLint fails on `any`, `@ts-ignore`, empty `catch` (evidence recorded).
- Integration test: API connects to real Postgres, runs the Drizzle migration up and down, `/health` returns OK.
- Feature registry: with the example feature enabled the route exists, disabled it returns 404, folder deleted the build and tests still pass.
- OpenAPI JSON generated and committed; CI fails if it is out of date.
- CI workflow runs green on GitHub (requires the repository to be pushed; see below).
- Meilisearch spike returns facets with counts for the sample data.

## Docs to update
`docs/dependencies.md` (new), `docs/files/*`, `docs/api/health.md`, `docs/contracts/{api,config}.md`, `docs/adr/0005-search-notes.md`,
`AGENTS.md` tooling section, `README.md`, `CHANGELOG.md`, `docs/AGENT_WORKFLOW.md` (decisions log).

## Needs approval (red zones touched by this plan)
- Adding all dependencies listed above (new dependencies, step 1 produces the license table first).
- Possible switch Redis -> Valkey if the license fails the allowlist.
- Creating the first migration (throwaway).

## Open questions for the user
1. Remote repository: push to GitHub is needed for CI. Which owner/name? (Org under FluxLab or personal account.)
2. Node LTS pin: use the container's v22 line, or a different version?
3. Is a throwaway example feature (`packages/features/_example`) acceptable in the template, or should it live only as a test fixture?

## Outcome (added at completion)
- Steps 1 to 8 done and merged; step 9 delivered in PR #10. Verified on GitHub Actions (for steps 1 to 8): lint, types, boundaries, 47 tests on real Postgres 17 / Redis 8 / Meilisearch v1.55.0, feature matrix on/off/deleted, license and audit policy, docs check, Compose stack healthy.
- Deviations from the plan:
  - Step 2: only `build` and `typecheck` scripts at first; other scripts were added in the step that makes them real (no stub scripts).
  - Step 3: TypeScript pinned to 6.0.3 (typescript-eslint and dependency-cruiser do not support 7); added a guard that fails when dependency-cruiser checks nothing.
  - Step 5: Drizzle has no down migrations (hand-written `.down.sql` convention); NestJS 12 is ESM-only (tsconfig base moved to NodeNext); feature tests live inside the feature package; independent review found 10 issues, all fixed (PR #2).
  - Step 6: findings recorded in ADR 0005; two decisions still open (Ukrainian morphology, variant facet counts).
  - Step 8: first CI run found a broken Meilisearch healthcheck in Compose and a misnamed audit script; both fixed.
  - Docs agent role (step 9) was done by the orchestrating agent, not a separate Haiku agent.
- Approved license exceptions are recorded in `AGENTS.md` section 16 and `scripts/license-policy.json`.
- Not done (by design, outside this plan): domain logic, providers, e2e tests, production deployment, branch protection.
