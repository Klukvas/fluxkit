# AGENTS.md — Fluxkit

_Fluxkit — white-label e-commerce template. Powered by [FluxLab](https://flux-lab.dev/en)._

Shared rules for all AI coding agents (Claude Code, Codex, etc.).
`CLAUDE.md` imports this file, so this is the single source of truth.

## 1. What we are building

A **white-label e-commerce template** that is sold to clients and then customized by our team.
Every decision must keep these facts in mind:

- We do NOT know the client's niche in advance (clothes, tools, food, digital goods...).
- Design WILL be replaced per client (colors, fonts, layout, components).
- Features WILL be added or removed per client (reviews, wishlist, coupons, multi-currency...).
- The codebase must stay easy to hand over: clear structure, docs, demo data, one-command setup.

**Optimize for changeability, not for cleverness.** Prefer boring, explicit, well-named code.

## Stack (decided, see `docs/adr/0002-tech-stack.md`)

- Own core (no Saleor/Medusa), see `docs/adr/0001-own-core.md`.
- Language: TypeScript everywhere (monorepo, shared types and validation schemas).
- Backend: NestJS (modules map to core domains and feature modules). Public API: REST + OpenAPI.
- DB: PostgreSQL + Drizzle ORM. Migrations via Drizzle, reversible.
- Search/filters: Meilisearch (typo tolerance, filters, facets), fed from Postgres via events/queues. Spike findings and open decisions (Ukrainian morphology,
  variant-level facet counts) are in `docs/adr/0005-search-notes.md`; one document per variant + `distinctAttribute: productId`.
- Queues/cache: Redis + BullMQ.
- Storefront: Next.js (App Router) + Tailwind, design tokens as CSS variables.
- Admin: React SPA (Vite), shares the UI library and tokens with the storefront.
- Deployment: `infra/docker-compose.yml` runs Postgres, Redis and Meilisearch today (verified in CI). API/worker images and a production deployment are not built yet.
- First market: Ukraine (UAH, `uk`/`en`, Ukrainian payment and shipping providers as plugins), then EU/US.
  Currencies, locales, payment and shipping providers are core abstractions, not hardcoded.

## Tooling (decided, see `docs/adr/0003-tooling.md`)

- Package manager / monorepo: pnpm workspaces + Turborepo.
- Tests: Vitest (unit, integration); Playwright (e2e) is planned, not set up yet. Integration tests use real Postgres, Redis and Meilisearch (CI service containers), not mocks.
- Lint/format: ESLint (strict TS rules) + Prettier; dependency-cruiser for module boundaries.
- Hosting/CI: GitHub + GitHub Actions (CI requirements in section 18).

Root scripts (always check `package.json` before using; do not invent commands):
- Available now: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` (`pnpm format` to fix), `pnpm check:boundaries`,
  `pnpm test` (builds first, then runs Vitest in every package), `pnpm openapi:export` (regenerates `docs/api/openapi.json`),
  `pnpm db:migrate` (applies the pending migrations to `DATABASE_URL`, forward only; see `README.md`), `pnpm seed` (demo catalog into the migrated `DATABASE_URL` database, idempotent, refuses `NODE_ENV=production`; see `seeds/README.md`), `pnpm admin:create` (creates one admin user, first owner; see `README.md`), `pnpm admin:unlock` (clears the lockout of one admin user; see `README.md`), `pnpm check:licenses`, `pnpm check:docs` (vs `origin/main`), `pnpm audit:prod`, `pnpm notices`, `pnpm feature-matrix on|off|deleted` (`deleted` only with `CI=true`, it removes files).
- App dev servers (no root `dev` yet): `pnpm --filter @fluxkit/storefront dev`, `pnpm --filter @fluxkit/admin dev` (run `pnpm build` once first so workspace packages exist).
- Run the built API: `pnpm build && pnpm --filter @fluxkit/api start` (reads the root `.env`; variables already set in your shell take precedence).
- Planned, added later: root `pnpm dev`, `pnpm test:e2e`. Until a script exists it is intentionally absent, not stubbed: a script that always passes would mask missing checks.
- Integration tests need real services and fail (not skip) without `DATABASE_URL` (database name must end in `_test`), `REDIS_URL`, `MEILI_URL` and `MEILI_MASTER_KEY`; see the README quick start.
- Prettier covers code and config files, not Markdown. `check:boundaries` also fails if dependency-cruiser cruises zero modules.

Versions: Node 22 (`.nvmrc`), pnpm 10.28.0 (`packageManager`), **TypeScript pinned to 6.0.3** (see below), exact dependency versions pinned in `package.json` and `pnpm-lock.yaml`.

TypeScript 7 is NOT used yet: `typescript-eslint` and `dependency-cruiser` do not support it (the latter silently checks nothing). Do not bump TypeScript
until both support it and `pnpm lint` and `pnpm check:boundaries` are verified; changing the pin is a red-zone decision (section 14).

## 2. Core architecture principles

### 2.1 Feature modules (add/remove without breaking the rest)
- Each optional feature lives in its own module/folder (e.g. `features/wishlist`, `features/reviews`, `features/coupons`).
- Core code must NEVER import from an optional feature directly. Features plug in through
  extension points: registry, config flags, events, slots, or hooks.
- Every optional feature must be toggleable by a single config flag (`features.wishlist.enabled`).
  With the flag off: no UI, no routes, no API endpoints, no DB side effects at runtime.
- Removing a feature = deleting its folder + its flag + its migration (documented in the feature's README). Check that this actually works when you add a feature.
- Mechanism (see `docs/contracts/config.md`): a feature package declares `"fluxkit": {"feature": "<name>"}` and exports `featureModule`; `apps/api` discovers and
  dynamically imports only enabled ones from `FEATURES_ENABLED`. Feature tests live inside the feature package so they disappear with it; core tests use a fixture feature.
- Core = catalog, cart, checkout, orders, customers, admin basics. Everything else is a feature.

### 2.2 Design is replaceable (theming)
- No hardcoded colors, fonts, spacing, radii, shadows in components. Use **design tokens** only
  (CSS variables / theme file). One place to rebrand.
- Separate **UI components** (dumb, presentational, token-styled) from **data/logic** (hooks, services).
  Redesign must be possible without touching business logic.
- Layout composition (page sections, order of blocks) should be configurable, not buried in components.
- All user-facing strings go through i18n. No hardcoded text in components.
- Do not bake client-specific branding, copy, or images into the template. Use placeholders and demo data.

### 2.3 Catalog data model (do not break this; details in `docs/adr/0004-core-data-model.md`)
- **Product** = catalog entity (card, SEO, reviews, categories). **Variant/SKU** = purchasable unit (price, stock, SKU code).
- Cart, order items, and stock reference `variant_id`, never `product_id`.
- A simple product still has one default variant. No special-case branches for "no variants".
- **Options** (color, size) generate variants. **Attributes** (material, length) describe the product. Never mix them.
- Product structure is **data-driven**: ProductType defines which options/attributes exist.
  Never hardcode niche-specific fields like `size` or `color` on the product schema or in UI.
- Attribute behavior is controlled by flags (`is_filterable`, `is_searchable`, `is_visible_on_storefront`,
  `is_comparable`, `is_sortable`, `is_internal`). Categories can override filter lists and order.
- `is_internal` data must never leave the public/storefront API. Enforce on the backend, not only in templates.
- Catalog filters operate on variants and group results by product. Search runs through a search index, not ad-hoc SQL JOINs.
- Money is stored in minor units (integers) with a currency code. Never floats.
- Order items store a **snapshot** (title, SKU, price, image) at purchase time.
- Prices live in a `price` table (variant, currency, minor-unit amount, optional customer group). Inventory lives in `inventory_level` per `variant_id + location_id`
  (`on_hand`, `reserved`) with reservations and an append-only `stock_movement` journal, so multi-warehouse needs no migration. Details: `docs/adr/0004-core-data-model.md`.

## 3. Working rules for agents

### Before coding
- Read `docs/HANDOFF.md` first: current state, next steps, open decisions and the owner's working agreements.
- Read the relevant module and its README first. Follow existing conventions over personal preference.
- If a request conflicts with section 2 (e.g. "just hardcode this color/field"), do the right thing within the architecture and tell the user why.
- If the request is ambiguous in a way that changes architecture (core vs feature, data model), ask a short question before building.

### While coding
- Make the smallest change that solves the task. No drive-by refactors, no unrelated renames or reformatting.
- No new dependencies without a clear reason; state the reason. Prefer what is already in the project.
- No client-specific logic in core. If something is niche-specific, make it config, a feature module, or an attribute.
- Keep public APIs and DB schema backward compatible where possible. Schema changes need a migration (up and down) and a note in the changelog.
  Drizzle does not generate down migrations: write `drizzle/NNNN_name.down.sql` by hand next to each generated migration (it must also delete that migration's row from `drizzle.__drizzle_migrations`,
  keyed by `created_at` = the `when` of its `meta/_journal.json` entry) and test up, down, up again, down. Destructive DB tests only run against a database whose name ends in `_test`.
- Never commit secrets. Use `.env` + `.env.example`; every new env var must be added to `.env.example` and the docs.
- Validate input at the boundary (API, forms, imports). Never trust client-sent prices, totals, or stock.
  Prices and totals are always recalculated on the server.
- Handle empty/loading/error states in UI (empty cart, no results, out of stock, payment failed).
- Accessibility baseline: semantic HTML, labels, keyboard navigation, contrast via tokens.
- Performance baseline: optimized images, lazy loading, no N+1 queries, paginate lists.

### After coding
- Run lint, type check, and tests for what you touched. Add or update tests for new behavior
  (especially cart, pricing, stock, checkout, permissions).
- Update docs when you change behavior: module README, `docs/`, `.env.example`, demo data/seeds.
- Report honestly: what changed, what was verified, what was NOT verified or skipped.

### Do not, without explicit approval
- Delete or rewrite migrations that may already be applied.
- Change payment, auth, or order-total calculation logic beyond the task.
- Run destructive DB or git commands (reset, force-push, drop).
- Add telemetry or third-party scripts.

## 4. Conventions

- Language: code, comments, commits, and docs in English. UI strings via i18n (default locale `uk`, plus `en`).
- Naming: descriptive and consistent with the domain (`variant`, `productType`, `attribute`, `option`). Avoid abbreviations.
- Commits: small, focused, imperative mood. One concern per commit.
- Branches: `feature/<name>`, `fix/<name>`, `chore/<name>`.
- Comments explain *why*, not *what*. Do not comment obvious code.

## 5. Repo layout

```
/apps
  /api               # NestJS: health, feature loader, DB; core domains to come (REST/OpenAPI)
  /storefront        # Next.js customer site (placeholder home page)
  /admin             # React SPA (Vite) (placeholder screen)
/packages
  /core              # domain logic: catalog rules implemented (docs/files/core.md); pricing, inventory, cart, checkout, orders, customers not yet
  /features          # optional modules, one package each (only the sample `_example` so far)
  /providers         # payment and shipping provider plugins (none yet)
  /ui                # token-based component library (shared by storefront and admin)
  /theme             # design tokens + tests/guards
  /config            # env parsing and feature flag parsing
  /api-client        # typed client generated from OpenAPI (empty scaffold)
/docs                # api, files, adr, plans, contracts, migrations, dependencies
/seeds               # @fluxkit/seeds: demo data and product type presets (pure data; runner in apps/api/src/seed)
/infra               # docker compose for Postgres, Redis, Meilisearch
/scripts             # CI and policy scripts (licenses, docs check, feature matrix, notices)
/.github             # CI workflow and Dependabot
```

## 6. Definition of done

- Works with the feature flag on and off (for feature modules).
- No hardcoded design values or user-facing strings.
- Respects Product/Variant and attribute rules above.
- Lint, types, and tests pass; new behavior is covered.
- Docs, `.env.example`, and seeds updated; `docs/HANDOFF.md` updated when project state changed.
- No client-specific code in the template.

## 7. Workflow (mandatory for every non-trivial task)

1. **Plan first.** Before editing code, write a short plan: goal, files/modules to touch, data/API changes,
   risks, how it will be verified. For small fixes one or two lines is enough. For anything touching the
   data model, checkout/payments, auth, or feature boundaries, put the plan in `docs/plans/<date>-<slug>.md`
   and get approval from the orchestrator/user before implementing.
2. **Check for existing functionality.** Before writing anything new, search the repo (code, `docs/api`,
   `docs/files`, feature modules) for something that already does it or can be extended. Reuse over reinvent.
   State in the plan what you found.
3. **Check scope.** Is it core or an optional feature? Does it need a flag? Does it break Product/Variant or
   theming rules? If unsure, ask.
4. **Implement** in small steps; keep the build green.
5. **Verify** with real commands (lint, types, tests, run the thing). Paste actual results in the report.
6. **Document** (section 8) in the same change, including `docs/HANDOFF.md` when project state changes.
7. **Report**: what changed, what was verified, what was not, open risks.

## 8. Documentation (kept short, kept current)

Docs are part of the code. A change without updated docs is not done.

- **API endpoints** → `docs/api/<module>.md`. One line per endpoint: `METHOD /path` — purpose, auth
  (public/customer/admin), request shape, response shape, errors, feature flag if any. No essays.
- **Files and modules** → `docs/files/<package-or-app>.md`. One line per significant file or folder:
  `path` — what it is responsible for (and what it must NOT do). Update when you add, move, rename or delete files.
- **Feature modules** → each has `README.md`: purpose, flag name, extension points used, DB tables/migrations,
  how to remove it cleanly.
- **Decisions** → `docs/adr/NNNN-title.md` for architectural decisions (context, decision, consequences). Never edit old ADRs; supersede them.
- **Changelog** → `CHANGELOG.md`, one line per user-visible or schema change.
- **Handoff** → `docs/HANDOFF.md`: current state, next steps, open decisions, working agreements. New agents read it first. Every PR that changes project state
  (a PR merged or opened for a plan step, a step finished, a decision taken, a working agreement changed) updates it and its "Last updated" date. Keep it short.
- Style: bullet lists and tables, present tense, no marketing text. If a doc grows long, split it.
- Docs describe what exists. Do not document planned behavior as if it is implemented.

## 9. Honesty and failure handling

- **Never mask failures.** Do not swallow errors, add empty `catch`, blanket try/catch, or fallback values that hide a bug.
  Do not skip, disable, delete, or weaken tests/lint/type rules to get green. Do not mock the thing under test.
  Do not hardcode expected outputs. Do not use `any`/`@ts-ignore`/`eslint-disable` to silence a real problem.
- Fix the root cause. If you cannot, stop and say so with the exact error, what you tried, and your best hypothesis.
- If something is stubbed, mocked, or fake, label it clearly in code and in the report (`TODO(fluxkit): ...`).
- Never claim "done" or "tests pass" without having run them. Say "not verified" when it is not.
- If you find an unrelated bug, report it; do not silently fix it inside an unrelated change.
- Errors shown to users are friendly; errors in logs are complete. Fail loudly in dev, gracefully in prod, never silently.

## 10. Roles and models

Agents work in one of these roles. See `docs/AGENT_WORKFLOW.md` for model/effort assignments and handoffs.

- **Architect**: data model, module boundaries, ADRs. Does not write feature code.
- **Orchestrator**: turns a goal into a plan and tasks, delegates, integrates, checks Definition of Done.
- **Developer**: implements one scoped task inside the plan. Owns specific files/paths; does not edit outside them.
- **QA / Reviewer**: reviews diffs and writes/runs tests. The reviewer must be a different agent (ideally a different model) than the author.
- **Docs/chores**: updates docs, changelog, seeds, formatting.

Rules:
- Developers stay within their task and owned paths. Out-of-scope needs go back to the orchestrator.
- Parallel agents must not touch the same files. The orchestrator assigns path ownership.
- Handoffs are written (plan file, task description, report), not assumed from chat memory.
- A role that is blocked by a missing decision escalates upward (Developer → Orchestrator → Architect → user).

## 11. Security and data safety

- Never trust the client: recalculate prices, totals, discounts, stock on the server.
- Authorization on every admin endpoint and on every customer resource (owner checks). Default deny.
- Parameterized queries only. Escape/sanitize rendered user content (reviews, descriptions).
- Do not log secrets, tokens, full card data, or unnecessary personal data.
- Payment webhooks: verify signatures, be idempotent.
- Uploads/imports: validate type, size, and structure; never execute uploaded content.
- Add rate limits to auth, search, and checkout endpoints.

## 12. Git and review

- One concern per branch/PR. PR description: goal, plan link, what changed, how verified, risks, docs updated.
- Do not push to `main` directly. Do not force-push shared branches.
- Do not commit generated files, build output, or secrets.
- Review checklist: architecture rules (section 2), tests, docs, security (section 11), no masked failures (section 9).

## 13. Testing strategy

- **Money logic is TDD, no exceptions**: prices, discounts, coupons, taxes, shipping cost, stock changes, order totals,
  refunds. Write failing tests first (include edge cases: rounding, zero/negative, currency, concurrency on stock),
  then the code. The report must show the failing-then-passing evidence.
- Everything else: tests are written together with the code, in the same PR. Order is not enforced.
- Bug fixes: add a regression test that fails before the fix.
- Test the real thing. Mock only external boundaries (payment provider, email, third-party APIs).

## 14. Stop and ask (red zones)

An agent MUST stop and get approval from the orchestrator/user before doing any of the following:

- Adding a new dependency (state: why, license, size, alternatives considered).
- Creating, changing, or removing a DB migration or schema.
- Changing a public contract (see section 17): API shape, extension point, config schema, theme tokens, events.
- Touching payments, auth/permissions, or order-total/pricing calculation outside the approved plan.
- Deleting or moving files outside the task's owned paths.
- Moving something between core and a feature module, or adding a new feature flag.
- Running destructive commands (data reset, force-push, dropping tables).

Everything else the agent decides itself and mentions in the report. Do not ask about trivia.

## 15. Template cleanliness (master + forks)

- The master repository is the product. It must contain NO client data: no client names, domains, emails,
  logos, copy, keys, real products, or orders. Only placeholders and demo seeds.
- Client work happens in a **separate fork or private repo per client**, never in master.
- Generic improvements made for a client are ported back to master as a separate, cleaned PR.
- Master receives updates from forks only through reviewed PRs; client forks pull upstream releases (SemVer, section 17).
- Before any release of master, a human confirms there are no client traces (names, secrets, assets).

## 16. Dependencies

- Allowed licenses for code dependencies (anything installed into our packages): MIT, Apache-2.0, BSD-2/3, ISC, 0BSD, CC0.
  GPL, AGPL, SSPL, and "source-available" licenses are forbidden there; anything unusual needs explicit approval.
- Approved for **development tooling only** (devDependencies, never shipped to clients' runtime): MPL-2.0 (e.g. lightningcss, unmodified), Python-2.0 (argparse),
  BlueOak-1.0.0 (minimatch) and "Apache-2.0 AND MIT" combined expressions (@swc/core binaries). Approved by the owner on 2026-10-14. Runtime dependencies stay on the strict list.
- Approved 2026-10-14 for ONE runtime package: **Python-2.0** for `argparse` (transitive of `@nestjs/swagger` -> `js-yaml`). `scripts/license-policy.json` is the machine-readable copy of this policy.
- Also approved by the owner on 2026-10-14, each for ONE specific case: **LGPL-3.0-or-later** for the unmodified, dynamically loaded prebuilt `@img/sharp-libvips-*` binaries
  (Next.js image optimization; never copy or modify their code; keep the notices), and **CC-BY-4.0** for the `caniuse-lite` browser-data package (keep attribution).
  Any other LGPL/GPL-family or CC-BY package still needs its own approval. Third-party notices must be shipped with a client delivery.
- External services run as separate unmodified processes (Docker Compose) are tracked in `docs/dependencies.md` with an explicit decision.
  Approved exception: **Redis 8+ under AGPLv3** (legal sign-off given by the owner's lawyer, 2026-10-14). We run it unmodified and never
  fork or patch it. If the license choice or how we ship it changes, re-confirm with legal.
- Commit the lockfile. Pin exact versions for production dependencies.
- Dependency audit (vulnerabilities + license check) runs in CI and must pass.
- Prefer fewer, well-maintained dependencies. Do not add a library for something small.
- Record each non-obvious dependency choice in `docs/adr/` or the module README.

## 17. Contracts and versioning

- The template follows **SemVer**. Public contracts are listed in `docs/contracts/` (one file per area):
  API endpoints, UI slots, hooks and events, feature-flag/config schema, theme tokens, DB tables meant for extension.
- Anything not listed there is internal and may change freely. Do not rely on internals from feature modules or client code.
- Breaking a public contract = major version, a migration guide in `docs/migrations/`, and a `CHANGELOG.md` entry.
  Deprecate first (one minor release) when possible.
- Customization must go through public contracts (slots, hooks, config, tokens), not by editing core files.
  If a client needs something that requires editing core, add a proper extension point instead.

## 18. CI requirements

CI (`.github/workflows/ci.yml`) runs on every PR and on pushes to `main`; all jobs must pass before merge:

- `verify`: lint, format check, type check, module boundary check, unit/integration tests (service containers: Postgres 17, Redis 8, Meilisearch v1.55.0).
- `feature-matrix` (`scripts/feature-matrix.sh`): `on` (API started with `FEATURES_ENABLED=example`, route exists), `off` (404), `deleted`
  (feature folder removed, lint/types/boundaries/tests still pass). Core must never depend on a feature.
- `policy`: `pnpm check:licenses` (policy in `scripts/license-policy.json`), `pnpm audit:prod` (fails on high severity in production dependencies),
  and `pnpm notices` (uploads `THIRD_PARTY_NOTICES.md` as an artifact; ship it with client deliveries).
- `docs` (PRs only, `scripts/check-docs.mjs`): changed controllers need `docs/api/` updates, schema/migration changes need `CHANGELOG.md`, new packages need `docs/files/`,
  renamed design tokens need `docs/contracts/theme-tokens.md`. `openapi.json` freshness is enforced by a test.
- `compose`: `infra/docker-compose.yml` starts and every service becomes healthy.
- Dependabot (`.github/dependabot.yml`) updates npm, GitHub Actions and Docker images weekly; TypeScript major bumps are ignored until the linters support them.
- Local equivalents: `pnpm lint`, `format:check`, `typecheck`, `check:boundaries`, `test`, `feature-matrix`, `check:licenses`, `audit:prod`, `notices`, `check:docs`.
  There is no script for the `compose` job; run `docker compose --env-file .env -f infra/docker-compose.yml up -d --wait` yourself.
