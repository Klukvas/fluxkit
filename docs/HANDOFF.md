# Handoff: current state and how we work

Read this first (Claude Code, Codex or a human). Rules live in `AGENTS.md`; decisions in `docs/adr/` (0001 to 0044, index in `docs/adr/README.md`); plans in `docs/plans/`.
The long per-step history that used to live here is archived verbatim in `docs/HISTORY.md` (not current). Update this file in every PR that changes project state; keep it short and keep "Last updated" to one line.

Last updated: 2026-11-01, `origin/main` at `e364acc` (PR 207, ADR 0043, merged); PR 208 (`fix/search-admission-tails`: PR 207 review tails, ADR 0044, re-measurement at 20 000 products) open, independently reviewed, its review findings F1 to F6 fixed on the branch.

## 1. Current state

Fluxkit is a white-label e-commerce template: TypeScript monorepo, NestJS + Drizzle/Postgres, Meilisearch, Redis/BullMQ, Next.js storefront, React/Vite admin SPA served under `/admin-ui/`. Migrations `0001` to `0011` (all owner-approved; see section 3). Quick start: `README.md`.

- **Core commerce (complete):** catalog (ADR 0006), auth and roles, pricing and inventory, cart, checkout, orders, customers, scheduler jobs 1 to 14 (`docs/api/jobs.md`). Review follow-ups: `docs/plans/2026-10-16-catalog-review-findings.md`, `docs/plans/2026-10-18-cart-orders-review-fixes.md`.
- **Storefront v1 and Admin UI v1 (complete):** storefront catalog, cart, accounts, checkout, payment and emailed-link pages, "Your data", legal placeholders, search and facets; admin catalog, prices and stock, orders, customers, users, media (ADR 0028), Shipping, Email, Payments, Personal data, Audit log and Search areas. Playwright e2e in both.
- **Shipping (built, not live-verified):** ADR 0029, methods, rates, shipments, tracking job 8. Providers: test-only `fake` and `nova_post` (ADR 0030); `nova_post` ran against a local stub only, and production answers its label request `422`. Fulfilment is manual. Plans: `docs/plans/2026-10-24-shipping.md`, `docs/plans/2026-10-25-nova-post-plugin.md` (reviewed, fixed).
- **Email (built, not live-verified):** ADR 0031, outbox, jobs 9 and 10, password reset, optional verification, order and shipment mails, admin Email area. Providers: `fake`, `resend` (stub only, never reached Resend). Plan `docs/plans/2026-10-26-email.md`, review `docs/plans/2026-10-28-email-review.md` (fixed).
- **Payments (built, not live-verified):** ADR 0032, payment attempts, signed webhook, reconcile job 11, refunds (`payments.refund`), storefront and admin UI, e2e with the fake. Providers: `fake`, `monobank` (stub only). Plan `docs/plans/2026-10-26-payments-monobank.md`, independent review `docs/plans/2026-10-29-payments-review.md` (fixed, #173).
- **Privacy (built, legal review pending):** ADR 0033 and 0035, migration `0009`, data inventory with CI guards, export, self-service deletion, admin erasure, audit log, job 12 `anonymise-orders` (off until `ORDER_CONTACT_RETENTION_DAYS` is set), admin Personal data and Audit log areas, storefront "Your data" page and legal placeholders, e2e in both suites, operator guide `docs/privacy/README.md`. Plan `docs/plans/2026-10-29-privacy.md`; independent review of the API (steps 4 to 8) `docs/plans/2026-10-29-privacy-review.md`, F1 to F7 fixed. Independent review of the UI (steps 9 to 12) `docs/plans/2026-10-29-privacy-ui-review.md`, fixed in #191 (the legal release guard checks every placeholder and `apps/storefront/src/config/legal-identity.json`; erased-order message, password clearing, plurals). Operator documents (data inventory, RoPA template, processors, breach procedure) merged in #187.
- **Search (built, measured at scale):** plan `docs/plans/2026-10-29-search.md` (steps 0 to 11 done, 11 in part), ADR 0034 and 0036 to 0040, migration `0010` (queue and index state tables). `SEARCH_ENABLED` is off by default in code (the template `.env.example` turns it on); with it off no route, queue write or UI exists. Pieces: vendored Snowball stemmers in core, queue marks in every catalog, price and stock writer, jobs 13 `sync-search-index` and 14 `rebuild-search-index`, `pnpm search:reindex`, store and admin routes (`docs/api/search.md`, `docs/contracts/search.md`), storefront box, results and facets with the SQL fallback (ADR 0039), shared list cache with stale-while-error (ADR 0040; document version 2, so an upgrade rebuilds the index), demo synonym seeds. Three independent reviews (`docs/plans/2026-10-29-search-review.md`, `-search-ui-review.md`, `-search-finish-review.md`), fixes merged (#186, #188). At scale: measured at 20 000 products in a shared sandbox twice (plan `docs/plans/2026-10-29-search.md`, "Measurements at scale (2026-10-31)" and "Re-measurement at 20 000 products (2026-11-01)"): now met at concurrency 1 and 8 except deep pages (search p95 127 ms without them at 8), sustained 50 changes a second (oldest change 60 s, queue drained every tick) and the `isFilterable` flip in place; missed at concurrency 32 (search p95 885 ms, suggest 132 ms) and for deep pages (F3, the only source of `engine_timeout` measured); catalog pages at concurrency 32 no longer fail (19 % to 0.1 % `503`). Engine client history: ADR 0041 (keep-alive `node:http`, bounded interactive lane; #204), ADR 0042 (one admission per search pass, disconnects stop engine calls, `engine.interactiveLane` in `GET /admin/search/status`; #206), ADR 0043 (a waiting pass admitted on the free slots; #207), ADR 0044 in PR 208, open (a granted pass grows on spare slots while nobody waits and gives them back when another pass queues; `abandoned` no longer counts an aborted arrival; plan `docs/plans/2026-11-01-search-admission-tails.md`). PR 205 (plan `docs/plans/2026-10-31-search-sync-and-settings.md`, merged): job 13 drains until its budget; `isFilterable` applied in place; document version 3. Open: F3 deep pages, F4 sequential rebuild (first build 2.4 to 2.6 min at 20 000 products, slower than before), F5 status `documents` drift.
- **Deployment (example, partly verified):** `docs/deployment.md` (what was verified, TLS, backups, readiness checklist), root `Dockerfile`, `infra/docker-compose.prod.yml`, `infra/proxy/` (nginx, Caddy), `infra/production.env.example`, `pnpm check:env`, CI job `deploy-smoke`. The plan `docs/plans/2026-10-29-production-deploy.md` still says "proposed" and has no independent review; no real TLS, DNS or host was tried.
- **Tooling and CI:** root scripts: `build typecheck lint format format:check check:boundaries check:env test test:e2e db:migrate seed admin:create admin:unlock jobs:run-once search:reindex openapi:export check:licenses check:docs notices feature-matrix audit:prod`. CI jobs (`.github/workflows/ci.yml`): `verify`, `feature-matrix`, `e2e`, `policy`, `docs`, `compose`, `deploy-smoke`. Matrix modes: `on off deleted providers-*` (nova-post, email, payment variants) `search-on search-off` (`scripts/feature-matrix.sh`).
- **Test stability:** the admin e2e flakes were root-caused and fixed in #193 (refund dialog focus race, audit filter key bug, spec isolation); all rAF focus sites use the shared `useFocusAfterCommit` hook (`apps/admin/src/lib/use-focus-after-commit.ts`, guard `apps/admin/src/focus-guards.spec.ts`, #194); the engine task timeout test is deterministic (#190).
- **Dependencies:** Dependabot bumps merged (swc, bullmq, dependency-cruiser, next 16.4.3, `@nestjs/swagger` 12.0.4). PSF-2.0 for `argparse` approved 2026-10-30 (#192).
- **Open PRs:** PR 208 (`fix/search-admission-tails`, ADR 0044), independently reviewed, review findings fixed on the branch; to merge when CI is green.
- **Not built:** live provider verification (all three plugins ran against stubs only), LiqPay/WayForPay, returns, admin email flows, two-factor, rate limits on the plain catalog routes of `/store/*`, search numbers on production hardware.

## 2. Next steps (in order)

1. Owner-only items of section 3 (the AGENTS.md sync was merged in #196 and the owner decisions of 2026-10-30 are recorded): live provider checks; legal review. Migrations `0009_privacy` and `0010_search` and the vendored Snowball code were confirmed by the owner on 2026-10-31 (first approved by the orchestrator on 2026-10-29 under the standing autonomy grant); migration `0011` was approved by the owner personally on 2026-10-30. Nothing below replaces these.
2. Search: PR 208 (ADR 0044) is open and reviewed; merge when CI is green. Re-measured at 20 000 products (plan `docs/plans/2026-10-29-search.md`, "Re-measurement at 20 000 products (2026-11-01)"): targets missed at concurrency 32 and for deep pages; F3 to F5 open. Still to do: test the engine-down fallback in a real browser (unit level only).
3. Production deployment: owner approval of the plan, an independent review of the images and proxy, a first green `deploy-smoke` run on GitHub (it passed locally only, per `docs/deployment.md`), then a dry run on a real host.
4. Live provider checks once the owner supplies keys (section 3).
5. Launch blockers: rate limits on the plain catalog routes of `/store/*` (needs a dependency, red zone; `apps/api/src/rate-limit/rate-limiter.ts` has windows for search but none for catalog reads); Swagger UI and `/docs-json` decision; `TRUST_PROXY` set to the exact hop count (ADR 0026). Behind a proxy the search results page counts every shopper in one window unless `STOREFRONT_FORWARD_CLIENT_ADDRESS=true` (ADR 0038, default false); check per-address limits from two networks after deployment.
6. Multi-instance: the rate limits, the login throttle and the shared catalog list cache (ADR 0040) are in memory per process, so run one API instance and one storefront instance until they move to Redis.
7. Auth follow-ups, each with its own plan: session token rotation, Redis-backed login throttle (also for the in-memory reset and verification limits), two-factor.
8. Smaller follow-ups from the reviews (catalog review findings file); optional `CHECK (reserved <= 1000000000)` on `inventory_level`; watch for new Dependabot PRs.

## 3. Owner-only actions

Agents must not do these (AGENTS.md is the owner's file) or cannot (keys, contracts, lawyers).

**DECIDED 2026-10-30 (owner answers to explicit questions):**
- ADR 0038 accepted: client-address forwarding is enabled behind the edge (`STOREFRONT_FORWARD_CLIENT_ADDRESS=true` there), off by default.
- ADR 0037 and ADR 0040 accepted (the 5 minute stale window is accepted).
- Free orders (total 0) stay manual: an admin marks them paid; no change to the totals logic (payments review F2).
- `TRUNCATE` protection: statement-level triggers on the append-only tables (migration `0011`) plus the non-owner database role recommendation (`docs/deployment.md`, "Database roles").
- Payments attention-list and admin list indexes (migration `0011`).
- Audit action `admin_user.activated` (migration `0011` release, approved by the owner personally; `pnpm admin:create` is audited too).

**AGENTS.md edits:** done in #196.

**Approvals:** migrations `0001` to `0011` are all approved or confirmed by the owner; `0009_privacy`, `0010_search` and the vendored Snowball code (BSD-3-Clause, ADR 0034 decision 7) were confirmed by the owner personally on 2026-10-31 (first approved by the orchestrator on 2026-10-29 under the standing autonomy grant).

**Acceptances needed from the owner:**
- The ADR 0034 CONFIRM items (morphology acceptance).

**Live checks that need the owner's keys or go:**
- Resend S1 (`scripts/spikes/resend-verify.mjs`, a test API key in the environment only) and the Reply-To assumption (plugin README, R3).
- Monobank S1 and S2 (`packages/providers/monobank/README.md`, "Plan S1"): a TEST token as `MONOBANK_TOKEN`, a public `https` staging URL for the webhook. How an external partial refund is reported, and whether Monobank refuses an over-refund, are unverified.
- Nova Post: a real pickup-point order for the label (production answers `422`), the estimate, status codes other than `1` and `2` (`docs/plans/2026-10-25-nova-post-plugin.md`); a sandbox key; whether production shipments are billed.
- **Rotate the Nova Post key that was pasted into a chat earlier.**
- A verified sending domain (SPF, DKIM, DMARC) for `EMAIL_FROM`; a Monobank merchant contract for production.
- A real host: certificate, DNS, restore from backup, an update of a running shop (`docs/deployment.md`); search on production hardware (only a shared sandbox was measured, plan sections "Measurements at scale (2026-10-31)" and "Re-measurement at 20 000 products (2026-11-01)").

**Legal and business:**
- Privacy tasks O1 to O8 (`docs/plans/2026-10-29-privacy.md`, `docs/privacy/README.md`): GDPR applicability and EU representative; DPAs and roles for Resend, Nova Post, Monobank and the host; final privacy, terms and cookie texts; identity check for email requests; retention periods; RoPA and Commissioner notice; transfer mechanisms; breach contacts.
- Confirm the irreversible erasure rules with a lawyer before a client launch; set `ORDER_CONTACT_RETENTION_DAYS` for the client.
- The third-party notices gap (LGPL/GPL/Apache texts, cairo MPL-1.1, aom licence; `docs/dependencies.md`).
- A human check for client traces before any release (AGENTS.md section 15); branch protection on `main`.

**Pending owner decisions:**
- Shipping review m-10: cancelling a paid order with an active waybill.
- Swagger UI and `/docs-json` in production.

## 4. Open decisions and known gaps (short)

- ADR 0006 vs code: default page size (admin 50, store 24, ADR says 24) and the category filter on admin products (direct assignments only); fix the code or supersede the ADR. Sign-off wanted on ADR 0008 (required variant attributes asked only of active variants at publish).
- `openapi-typescript` is not used (peer range excludes TypeScript 6.0.3); `@fluxkit/api-client` is hand-written with contract tests. `"sideEffects": false` for `@fluxkit/core` and `@axe-core/playwright` (MPL-2.0) are not approved.
- The admin product search by slug is a table scan; a `text_pattern_ops` index needs a migration.
- Nova Post choices where the evidence was silent (ADR 0030, plan step 7b): `ids[]` filter, no `PUDO`, capped list pages, no address delivery. A note superseding ADR 0029 decision 9 in part may be wanted.
- Per-area known-gap lists are archived in `docs/HISTORY.md`; the maintained copies are in `apps/storefront/README.md`, `apps/admin/README.md`, `docs/api/shipping.md`, `docs/api/media.md`.
- Limits worth knowing: in-memory rate limits and the shared catalog list cache are per process (run one API instance); the append-only journals are guarded by `BEFORE TRUNCATE` triggers on the 8 append-only tables (migration `0011`), but a table owner or superuser can still disable or drop the triggers, and the erased-contact rule of `sales_order` can still be reversed by plain SQL (no trigger approved); `docs/deployment.md` "Database roles" describes the non-owner app role without `TRUNCATE`, not yet exercised by the API, jobs or e2e; order headers are not immutable at the database level; the example proxies never ran on a real host.

## 5. Working agreements (the owner's process)

- Plan first; data model, checkout, auth and payments go into `docs/plans/<date>-<slug>.md`. Decisions as a quiz: one question, three options, recommended first; no questions about trivia. Standing grant (2026-10-29): take the recommended options without asking.
- Independent review by a different agent, ideally a different model, for each plan; fixes in a separate PR with a regression test.
- TDD for money, stock and security rules, with failing-then-passing evidence; mutation checks on the rules that matter. Never mask failures: no skipped tests, no `any` or `@ts-ignore`, no weakened lint.
- Verify agent work yourself: run each check separately and read its exit code. Report what was NOT verified.
- Merge when CI is green (orchestrator, under the owner's autonomy grant); red zones (dependencies, migrations, public contracts, payments/auth/pricing, moving core and features, destructive commands) still need approval.
- Secrets never in chat, files, logs or commits; keys go to the environment only.
- Roles and models: `docs/AGENT_WORKFLOW.md`. The owner talks in Russian; code, docs and commits are English.

## 6. Run it locally

- Quick start and the checkout walkthrough: `README.md`. Integration tests need real Postgres (database name ending `_test`), Redis and Meilisearch, and fail without `DATABASE_URL`, `REDIS_URL`, `MEILI_URL`, `MEILI_MASTER_KEY`; run `pnpm test` in a subshell with them exported.
- Browser tests: `pnpm test:e2e` (separate `*_e2e_test` database in `E2E_DATABASE_URL`, wiped per suite; `apps/storefront/e2e/README.md`, `apps/admin/e2e/README.md`).
- Local check set: `lint`, `format:check`, `typecheck`, `check:boundaries`, `check:env`, `test`, `check:licenses`, `audit:prod`, `check:docs`, `pnpm --filter @fluxkit/api db:drift`.
- Use the test database from one process at a time. In the cloud sandbox there is no Docker daemon (services run natively) and `gh pr create` fails; use `gh api repos/Klukvas/fluxkit/pulls`. Agent worktrees in `.claude/worktrees/` are git-ignored.
- Conventions: Node 22, pnpm 10.28, TypeScript 6.0.3; NestJS is ESM (`.js` in relative imports); `packages/core` is pure; schema changes need a hand-written `.down.sql`; errors are `application/problem+json`; texts are JSONB locale maps.
