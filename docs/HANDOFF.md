# Handoff: current state and how we work

Read this first when you pick up the project (Claude Code, Codex, or a human). It says where we are, what is next, and the working agreements that are not obvious from the code.
Rules live in `AGENTS.md`; decisions in `docs/adr/`; plans in `docs/plans/`. This file is the short bridge between them.

**Update this file in every PR that changes project state** (a PR merged, a step finished, a decision taken, a new working agreement). Last updated: 2026-10-15 (4b).

## Where we are

Fluxkit is a white-label e-commerce template (own TypeScript core, NestJS + Drizzle/Postgres, Meilisearch, Redis/BullMQ, Next.js storefront, React/Vite admin). See `README.md` and `AGENTS.md`.

| Area | State |
|---|---|
| Monorepo scaffold, CI, licenses, docs | Done and merged (plan `2026-10-14-monorepo-scaffold.md`). |
| Catalog plan `2026-10-14-catalog.md` | Step 1 (ADR 0006), step 2 (core rules in `packages/core/src/catalog`), step 3 (schema + migration `0001_catalog`) merged. |
| Step 4, admin write API (`2026-10-15-catalog-api-design.md`) | Design merged. Core rules for it merged. 4a foundation + Brands merged (PR #17). **4b dictionaries (attributes, options, product types): in PR, pending.** |
| Not started | 4c categories, 4d products and variants; step 5 store API, 6 seeds and presets, 7 OpenAPI and docs, 8 independent review. |

## Next steps (in order)

1. Review and merge the 4b PR (owner's word). It adds `/admin/attributes`, `/admin/options`, `/admin/product-types` in `apps/api/src/catalog/admin/`; the shared helpers are `catalog/shared/` (`rules.ts` turns core change decisions into 409 `rule_violation`, `attribute-usage.ts` reads the "values exist" facts, `code-schemas.ts`).
2. 4c categories (+move with advisory lock), 4d products and variants (+publish lifecycle, options, categories, media, generate). Pattern: copy `admin/product-types/` (repositories take the executor as the first argument so rules run inside `withTransaction`).
3. Steps 5 to 8 of the catalog plan.
4. Separate plan: auth and roles (admin endpoints return 401 for everyone until it lands, by design).

## Open decisions (owner)

- Ukrainian search morphology and variant-level facet counts (ADR 0005). Block the search plan, not the catalog.
- Branch protection on `main` (GitHub settings, owner side). Pinning GitHub Actions by SHA.
- Permanent negative test for the dependency-cruiser `core-must-not-import-infrastructure` rule.
- `docs/api/catalog.md`, `docs/files/api.md`, `docs/files/core.md`, `docs/contracts/api.md` are written in catalog step 7.

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
