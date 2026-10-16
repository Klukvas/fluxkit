# Handoff: current state and how we work

Read this first when you pick up the project (Claude Code, Codex, or a human). It says where we are, what is next, and the working agreements that are not obvious from the code.
Rules live in `AGENTS.md`; decisions in `docs/adr/`; plans in `docs/plans/`. This file is the short bridge between them.

**Update this file in every PR that changes project state** (a PR merged, a step finished, a decision taken, a new working agreement). Last updated: 2026-10-16 (`pnpm db:migrate` added; auth plan complete, review fixes in PR).

## Where we are

Fluxkit is a white-label e-commerce template (own TypeScript core, NestJS + Drizzle/Postgres, Meilisearch, Redis/BullMQ, Next.js storefront, React/Vite admin). See `README.md` and `AGENTS.md`.

| Area | State |
|---|---|
| Monorepo scaffold, CI, licenses, docs | Done and merged (plan `2026-10-14-monorepo-scaffold.md`). |
| Catalog plan `2026-10-14-catalog.md` | Step 1 (ADR 0006), step 2 (core rules in `packages/core/src/catalog`), step 3 (schema + migration `0001_catalog`) merged. |
| Step 4, admin write API (`2026-10-15-catalog-api-design.md`) | Design merged. Core rules for it merged. 4a foundation + Brands merged (PR #17). 4b dictionaries (attributes, options, product types) merged (PR #19). 4c categories (+move with the tree advisory lock) merged (PR #20). 4d-1 products (CRUD, lifecycle, categories, media) merged. 4d-2 product options and variants merged (PR #22); the step 4 admin write API is complete. |
| Step 5, public store read API (`2026-10-16-catalog-store-api-design.md`) | Implemented in `apps/api/src/catalog/store/` (`GET /store/categories`, `GET /store/products`, `GET /store/products/:slug`; no auth; HTTP integration tests incl. leak and query-count tests); merged (PR #23). |
| Step 6, ProductType presets and demo data | Implemented: pure data in `seeds/` (`@fluxkit/seeds`: Clothing, Hand tool, Digital product presets; 9 categories, 1 brand, 8 published products in `uk`/`en`) and the idempotent runner `apps/api/src/seed/` (`pnpm seed`; creates through the admin services, never updates or deletes, refuses `NODE_ENV=production` without `--allow-production`); integration test reads the result through the store API; merged (PR #24). |
| Step 7 OpenAPI and docs | Done and merged (PR #25): `docs/api/catalog.md` (every `/admin` and `/store` route), `docs/contracts/api.md`, `docs/files/core.md`, `docs/files/api.md`, ADR index, README status, plan outcome. |
| Step 8 independent review | Done 2026-10-16 by two reviewers (Opus: security; Fable: correctness and tests). No leak of internal data found. The medium and low findings are fixed (PRs #27, #28, #29; ADR 0007 and 0008). Still open: see `docs/plans/2026-10-16-catalog-review-findings.md` (C5, information items, surviving mutations). The catalog plan is complete. |
| Auth and roles plan `2026-10-16-auth-and-roles.md` | Approved by the owner. Steps 1 (ADR 0009, core rules), 2 (migration `0002_admin_auth`), 3a (infrastructure) and 3b (login, logout, me, change-password, owner-only `/admin/users`) merged; admin routes are now protected by cookie sessions, roles and the CSRF header. Step 4 (`pnpm admin:create`, auth docs, README) merged. Step 5 (independent review by a different model) done; its findings are fixed in the branch `fix/auth-review-hardening` (PR pending; includes `pnpm admin:unlock`, ADR 0010), so the auth plan is complete once that PR is merged. Contract: `docs/contracts/api.md`. |

## Next steps (in order)

1. Auth and roles: merge the review-fix PR (`fix/auth-review-hardening`). First owner: `pnpm admin:create --email <address>`; locked out: `pnpm admin:unlock --email <address>` (README, Admin sign-in; ADR 0010). Auth follow-ups (each needs its own plan): decide whether Swagger UI and `/docs-json` stay public in production, audit log, `trust proxy`, session token rotation, Redis-backed login throttle, two-factor, password reset by email, customer accounts.
2. `pnpm db:migrate` exists (forward only; rollbacks stay manual through `drizzle/NNNN_name.down.sql`; no status or rollback command yet). `pnpm seed` and `pnpm admin:create` need a database migrated with it.
3. Launch blockers: rate limiting on `/store/*` (needs a dependency, red zone); decide whether Swagger UI and `/docs-json` stay public in production; `trust proxy` for the login IP limit behind a proxy.
4. Smaller follow-ups from the review: C5 (attribute and product-type facts read without a lock that value writes also take); tests for the surviving mutations (variant `position`, store `optionValues` order, SKU prefix truncation for long slugs); `variant.title` column that no route writes; the public attribute definition gets its display name in the serializer, not in core; `requiredText` in the store serializer still degrades a missing required title to `""` with a warning.
5. Next domain plan (the auth plan and its review are complete): pricing and inventory (money logic is TDD), or search indexing (blocked by the open decisions in ADR 0005). Ask the owner which comes first.

## Open decisions (owner)

- Ukrainian search morphology and variant-level facet counts (ADR 0005). Block the search plan, not the catalog.
- Branch protection on `main` (GitHub settings, owner side). Pinning GitHub Actions by SHA.
- Permanent negative test for the dependency-cruiser `core-must-not-import-infrastructure` rule.
- ADR 0006 (accepted) and the code differ on two points: the default page size (code: admin 50, store 24; ADR section 9: 24) and category filters (`?categoryId` on admin products matches direct assignments only; ADR section 8 says listings include descendants). Fix the code, or supersede the ADR; do not edit it.
- Owner sign-off still wanted on the core rule inside ADR 0008: required variant-level attributes are asked only of active variants at publish.

## Working agreements (the owner's process)

- **Plan before each non-trivial task**; data model, checkout, auth go into `docs/plans/<date>-<slug>.md` and get approval first.
- **Decisions as a quiz**: one question, three options, the recommended one first. Do not ask about trivia.
- **Merge PRs only on the owner's explicit word.** Opening a PR is fine; merging is not. Stacked PRs: merge the base first, then retarget the next one to `main`.
- **Independent review**: the author never reviews their own change; a different agent (ideally a different model) reviews.
- **Verify agent work yourself**: clean clone, run each check separately and read its exit code (a chained command hides failures), run mutation checks on the rules that matter (remove the guard or filter and see tests fail).
- **Money logic is TDD**; show the failing-then-passing evidence. Never mask failures: no skipped tests, no `any` or `@ts-ignore`.
- **Red zones** need approval: new dependencies, migrations and schema, public contracts, payments, auth, pricing, moving core and feature code, destructive commands.
- **Roles**: Architect (ADRs, schema), Orchestrator (plans, task split, verification), Developer (scoped task in owned paths, parallel agents use disjoint paths and worktrees), Reviewer, Docs. Models: `docs/AGENT_WORKFLOW.md`.
- **Language**: the owner talks in Russian; code, docs, commits, rules are English. Commits are small and imperative; branches `feature/`, `fix/`, `chore/`.

## Run it locally

Normal path: `README.md` quick start (Docker Compose for Postgres, Redis, Meilisearch, then `createdb fluxkit_test`).
Integration tests need real services and fail, not skip, without these variables (the database name must end in `_test`); run them in a subshell:

```bash
( export DATABASE_URL=postgres://<user>:<password>@127.0.0.1:5432/fluxkit_test \
         REDIS_URL=redis://127.0.0.1:6379 MEILI_URL=http://127.0.0.1:7700 MEILI_MASTER_KEY=<key>
  pnpm test )
```

- Only one process may use the test database at a time (migration tests drop the schema; `apps/api` runs spec files one by one on purpose).
- Full local check set before a PR: `pnpm lint`, `format:check`, `typecheck`, `check:boundaries`, `test`, `check:licenses`, `audit:prod`, `check:docs`, `pnpm --filter @fluxkit/api db:drift`, `openapi:export` (then Prettier on `docs/api/openapi.json`).
- In the cloud sandbox where this was built there is no Docker daemon: Postgres, Redis and Meilisearch run as native processes. Locally use Compose.
- `gh pr create` fails in that sandbox (GraphQL is blocked); create PRs with `gh api repos/Klukvas/fluxkit/pulls -f base=... -f head=... -f title=... -f body=...`.
- Agent worktrees live in `.claude/worktrees/` (git-ignored). Never commit them.

## Conventions worth knowing before you code

- Pinned: Node 22, pnpm 10.28, TypeScript 6.0.3 (do not bump; linters do not support 7). NestJS 12 is ESM: use `.js` extensions in relative imports.
- `packages/core` is pure TypeScript: no Nest, Drizzle or I/O (enforced by dependency-cruiser). Rules come from core; the API only feeds it facts from the database.
- Schema changes: generated migration plus hand-written `.down.sql` that also deletes its row in `drizzle.__drizzle_migrations`; test up, down, up, down.
- Errors are `application/problem+json`; unique violations map to 409 by constraint name (never by message text).
- Texts are JSONB locale maps; `DEFAULT_LOCALE` and `LOCALES` come from config.
