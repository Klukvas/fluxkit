# Handoff: current state and how we work

Read this first (Claude Code, Codex or a human). Rules live in `AGENTS.md`; decisions in `docs/adr/` (0001 to 0040, index in `docs/adr/README.md`); plans in `docs/plans/`.
The long per-step history that used to live here is archived verbatim in `docs/HISTORY.md` (not current). Update this file in every PR that changes project state; keep it short and keep "Last updated" to one line.

Last updated: 2026-10-29, `origin/main` at `77cd9a4`.

## 1. Current state

Fluxkit is a white-label e-commerce template: TypeScript monorepo, NestJS + Drizzle/Postgres, Meilisearch, Redis/BullMQ, Next.js storefront, React/Vite admin SPA served under `/admin-ui/`. Migrations `0001` to `0010`. Quick start: `README.md`.

- **Core commerce (complete):** catalog (ADR 0006), auth and roles, pricing and inventory, cart, checkout, orders, customers, scheduler jobs 1 to 14 (`docs/api/jobs.md`). Review follow-ups: `docs/plans/2026-10-16-catalog-review-findings.md`, `docs/plans/2026-10-18-cart-orders-review-fixes.md`.
- **Storefront v1 and Admin UI v1 (complete):** storefront catalog, cart, accounts, checkout, payment and emailed-link pages, "Your data", legal placeholders, search and facets; admin catalog, prices and stock, orders, customers, users, media (ADR 0028), Shipping, Email, Payments, Personal data, Audit log and Search areas. Playwright e2e in both.
- **Shipping (built, not live-verified):** ADR 0029, methods, rates, shipments, tracking job 8. Providers: test-only `fake` and `nova_post` (ADR 0030); `nova_post` ran against a local stub only, and production answers its label request `422`. Fulfilment is manual. Plans: `docs/plans/2026-10-24-shipping.md`, `docs/plans/2026-10-25-nova-post-plugin.md` (reviewed, fixed).
- **Email (built, not live-verified):** ADR 0031, outbox, jobs 9 and 10, password reset, optional verification, order and shipment mails, admin Email area. Providers: `fake`, `resend` (stub only, never reached Resend). Plan `docs/plans/2026-10-26-email.md`, review `docs/plans/2026-10-28-email-review.md` (fixed).
- **Payments (built, not live-verified):** ADR 0032, payment attempts, signed webhook, reconcile job 11, refunds (`payments.refund`), storefront and admin UI, e2e with the fake. Providers: `fake`, `monobank` (stub only). Plan `docs/plans/2026-10-26-payments-monobank.md`, independent review `docs/plans/2026-10-29-payments-review.md` (fixed, #173).
- **Privacy (built, legal review pending):** ADR 0033 and 0035, migration `0009`, data inventory with CI guards, export, self-service deletion, admin erasure, audit log, job 12 `anonymise-orders` (off until `ORDER_CONTACT_RETENTION_DAYS` is set), admin Personal data and Audit log areas, storefront "Your data" page and legal placeholders, e2e in both suites, operator guide `docs/privacy/README.md`. Plan `docs/plans/2026-10-29-privacy.md`; independent review of the API (steps 4 to 8) `docs/plans/2026-10-29-privacy-review.md`, F1 to F7 fixed. The UI steps 9 to 12 have no review file of their own. PR #187 (open) adds the operator documents.
- **Search (built, not measured at scale):** plan `docs/plans/2026-10-29-search.md` (steps 0 to 11 done, 11 in part), ADR 0034 and 0036 to 0040, migration `0010` (queue and index state tables). `SEARCH_ENABLED` is off by default in code (the template `.env.example` turns it on); with it off no route, queue write or UI exists. Pieces: vendored Snowball stemmers in core, queue marks in every catalog, price and stock writer, jobs 13 `sync-search-index` and 14 `rebuild-search-index`, `pnpm search:reindex`, store and admin routes (`docs/api/search.md`, `docs/contracts/search.md`), storefront box, results and facets with the SQL fallback (ADR 0039), shared list cache with stale-while-error (ADR 0040; document version 2, so an upgrade rebuilds the index), demo synonym seeds. Three independent reviews (`docs/plans/2026-10-29-search-review.md`, `-search-ui-review.md`, `-search-finish-review.md`), fixes merged (#186, #188). Known flaky tests were fixed.
- **Deployment (example, partly verified):** `docs/deployment.md` (what was verified, TLS, backups, readiness checklist), root `Dockerfile`, `infra/docker-compose.prod.yml`, `infra/proxy/` (nginx, Caddy), `infra/production.env.example`, `pnpm check:env`, CI job `deploy-smoke`. The plan `docs/plans/2026-10-29-production-deploy.md` still says "proposed" and has no independent review; no real TLS, DNS or host was tried.
- **Tooling and CI:** root scripts: `build typecheck lint format format:check check:boundaries check:env test test:e2e db:migrate seed admin:create admin:unlock jobs:run-once search:reindex openapi:export check:licenses check:docs notices feature-matrix audit:prod`. CI jobs (`.github/workflows/ci.yml`): `verify`, `feature-matrix`, `e2e`, `policy`, `docs`, `compose`, `deploy-smoke`. Matrix modes: `on off deleted providers-*` (nova-post, email, payment variants) `search-on search-off` (`scripts/feature-matrix.sh`).
- **Open PRs:** #187 (privacy operator documents), Dependabot #167 to #170.
- **Not built:** live provider verification (all three plugins ran against stubs only), LiqPay/WayForPay, returns, admin email flows, two-factor, rate limits on the plain catalog routes of `/store/*`, search performance numbers.

## 2. Next steps (in order)

1. Owner-only items of section 3: AGENTS.md edits, acceptances, live checks, legal review. Nothing below replaces them.
2. Measure search at scale (plan section 13 targets: 10 000 products, 100 000 documents, `GET /store/search` p95 150 ms, rebuild at most 10 minutes); step 11 recorded no numbers beyond spike S1. Also measure the hydration cost of a page and test the engine-down fallback in a real browser (unit level only).
3. Production deployment: owner approval of the plan, an independent review of the images and proxy, a first green `deploy-smoke` run on GitHub (it passed locally only, per `docs/deployment.md`), then a dry run on a real host.
4. Live provider checks once the owner supplies keys (section 3).
5. Launch blockers: rate limits on the plain catalog routes of `/store/*` (needs a dependency, red zone; `apps/api/src/rate-limit/rate-limiter.ts` has windows for search but none for catalog reads); Swagger UI and `/docs-json` decision; `TRUST_PROXY` set to the exact hop count (ADR 0026). Behind a proxy the search results page counts every shopper in one window unless `STOREFRONT_FORWARD_CLIENT_ADDRESS=true` (ADR 0038, default false); check per-address limits from two networks after deployment.
6. Multi-instance: the rate limits, the login throttle and the shared catalog list cache (ADR 0040) are in memory per process, so run one API instance and one storefront instance until they move to Redis.
7. Auth follow-ups, each with its own plan: session token rotation, Redis-backed login throttle (also for the in-memory reset and verification limits), two-factor.
8. Smaller follow-ups from the reviews (catalog review findings file); optional `CHECK (reserved <= 1000000000)` on `inventory_level`; merge or close the Dependabot PRs and #187.

## 3. Owner-only actions

Agents must not do these (AGENTS.md is the owner's file) or cannot (keys, contracts, lawyers).

**AGENTS.md edits (everything merged so far; sources: plans, `CHANGELOG.md`):**
- Section 1, root scripts: `pnpm test:e2e`, `pnpm jobs:run-once`, `pnpm check:env`, `pnpm search:reindex`. Tooling line: Playwright is set up for storefront and admin, no longer "planned".
- Section 1, configuration: `SCHEDULER_ENABLED`, `SCHEDULER_INTERVAL_SECONDS`, `ORDER_TOKEN_SECRET`, `MAX_OPEN_ORDERS`, `TRUST_PROXY`, `ADMIN_DEV_API_URL`; e2e-only `E2E_DATABASE_URL`, `E2E_PORT`, `E2E_API_PORT`, `E2E_STOREFRONT_PORT`, `E2E_STOREFRONT_UNFORWARDED_PORT`, `E2E_SEARCH`, `ADMIN_E2E_PORT`, `ADMIN_E2E_API_PORT`; `SHIPPING_PROVIDERS_ENABLED`, `NOVA_POST_API_KEY`, `NOVA_POST_ENVIRONMENT`; `EMAIL_PROVIDER`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `STOREFRONT_PUBLIC_URL`, `RESEND_API_KEY`, `FAKE_EMAIL_CAPTURE_FILE` (test); `PAYMENT_PROVIDERS_ENABLED`, `MONOBANK_TOKEN`, `FAKE_PAYMENT_ADOPT_WEBHOOKS` (test); `ORDER_CONTACT_RETENTION_DAYS`, `STOREFRONT_REQUIRE_LEGAL_TEXT` (build time); `SEARCH_ENABLED`, `MEILI_URL` (now also read by the API), `MEILI_API_KEY`, `MEILI_INDEX_PREFIX`; `STOREFRONT_FORWARD_CLIENT_ADDRESS`.
- Section 1, Stack: Nova Post REST API (ADR 0030); email (ADR 0031); payments (ADR 0032); the Search line points to ADR 0034 and 0036 to 0040 instead of ADR 0005; the Deployment line says an example exists (`docs/deployment.md`).
- Section 2.1: core includes transactional email, the payments port and catalog search (the extension point is `SEARCH_PORT` in `apps/api/src/common/`, switched by `SEARCH_ENABLED`, not a feature package). Section 2.3: the price table sentence mentions a customer group the schema does not have (ADR 0012). A personal-data rule (inventory classification; none in logs, events or URLs); section 6 likewise.
- Section 11: mail links only from `STOREFRONT_PUBLIC_URL`; webhook verification over the raw body; erasure needs the password; the search engine is never reachable from browsers and the index holds public data only. Section 15: legal placeholders, a production build refuses them.
- Section 5 layout: `packages/providers` (fake, nova-post, email and payment providers), `docs/privacy/`, `apps/api/src/privacy/`, `apps/api/src/search/`, `infra/` production example and proxies.
- Section 16: `@playwright/test` 1.64.1 and `react-router` 8.4.0; the `@img/sharp-libvips-*` LGPL exception widened to API image re-encoding (`scripts/license-policy.json`); vendored Snowball stemmers (BSD-3-Clause, `docs/dependencies.md`); Resend, Monobank and Nova Post as external services and processors.
- Section 18: CI jobs `e2e` and `deploy-smoke`, `check:env` in `verify`; the matrix modes of section 1 above including `search-on` and `search-off`.

**Acceptances needed from the owner:**
- Migrations `0009_privacy` and `0010_search` and the vendored Snowball code were approved by the orchestrator under the owner's standing autonomy grant of 2026-10-29, not by the owner personally. Confirm or reverse.
- ADR 0038 trust model: the storefront forwards the client address only when `STOREFRONT_FORWARD_CLIENT_ADDRESS=true`, which is correct only when the storefront is reachable through the edge alone and the edge replaces `X-Forwarded-For`. Decide whether to switch it on in every deployment.
- ADR 0037 (a cut last word uses no stems; Ukrainian partial precision 88.2%), ADR 0040 (stale lists are served from the shared cache when the engine fails; is a 5 minute stale window acceptable) and the ADR 0034 CONFIRM items (morphology acceptance).

**Live checks that need the owner's keys or go:**
- Resend S1 (`scripts/spikes/resend-verify.mjs`, a test API key in the environment only) and the Reply-To assumption (plugin README, R3).
- Monobank S1 and S2 (`packages/providers/monobank/README.md`, "Plan S1"): a TEST token as `MONOBANK_TOKEN`, a public `https` staging URL for the webhook. How an external partial refund is reported, and whether Monobank refuses an over-refund, are unverified.
- Nova Post: a real pickup-point order for the label (production answers `422`), the estimate, status codes other than `1` and `2` (`docs/plans/2026-10-25-nova-post-plugin.md`); a sandbox key; whether production shipments are billed.
- **Rotate the Nova Post key that was pasted into a chat earlier.**
- A verified sending domain (SPF, DKIM, DMARC) for `EMAIL_FROM`; a Monobank merchant contract for production.
- A real host: certificate, DNS, restore from backup, an update of a running shop (`docs/deployment.md`); search at a real catalog size.

**Legal and business:**
- Privacy tasks O1 to O8 (`docs/plans/2026-10-29-privacy.md`, `docs/privacy/README.md`): GDPR applicability and EU representative; DPAs and roles for Resend, Nova Post, Monobank and the host; final privacy, terms and cookie texts; identity check for email requests; retention periods; RoPA and Commissioner notice; transfer mechanisms; breach contacts.
- Confirm the irreversible erasure rules with a lawyer before a client launch; set `ORDER_CONTACT_RETENTION_DAYS` for the client.
- The third-party notices gap (LGPL/GPL/Apache texts, cairo MPL-1.1, aom licence; `docs/dependencies.md`).
- A human check for client traces before any release (AGENTS.md section 15); branch protection on `main`.

**Pending owner decisions:**
- Free-order settlement: should an order of total 0 be marked paid automatically (payments review F2).
- A migration for the attention-list index on `payment` (payments review, open items).
- An audit code for `admin_user.activated`.
- DB-level `TRUNCATE` protection of the append-only journals including `admin_audit_event` (privacy review F5; recommended: a non-owner application role without `TRUNCATE`).
- Shipping review m-10: cancelling a paid order with an active waybill.
- Swagger UI and `/docs-json` in production.

## 4. Open decisions and known gaps (short)

- ADR 0006 vs code: default page size (admin 50, store 24, ADR says 24) and the category filter on admin products (direct assignments only); fix the code or supersede the ADR. Sign-off wanted on ADR 0008 (required variant attributes asked only of active variants at publish).
- `openapi-typescript` is not used (peer range excludes TypeScript 6.0.3); `@fluxkit/api-client` is hand-written with contract tests. `"sideEffects": false` for `@fluxkit/core` and `@axe-core/playwright` (MPL-2.0) are not approved.
- The admin product search by slug is a table scan; a `text_pattern_ops` index needs a migration.
- Nova Post choices where the evidence was silent (ADR 0030, plan step 7b): `ids[]` filter, no `PUDO`, capped list pages, no address delivery. A note superseding ADR 0029 decision 9 in part may be wanted.
- Per-area known-gap lists are archived in `docs/HISTORY.md`; the maintained copies are in `apps/storefront/README.md`, `apps/admin/README.md`, `docs/api/shipping.md`, `docs/api/media.md`.
- Limits worth knowing: in-memory rate limits and the shared catalog list cache are per process (run one API instance); append-only journals can be bypassed by `TRUNCATE` or plain SQL at database-privilege level; order headers are not immutable at the database level; the example proxies never ran on a real host.

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
