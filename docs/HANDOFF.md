# Handoff: current state and how we work

Read this first (Claude Code, Codex or a human). Rules live in `AGENTS.md`; decisions in `docs/adr/` (0001 to 0035, index in `docs/adr/README.md`); plans in `docs/plans/`.
The long per-step history that used to live here is archived verbatim in `docs/HISTORY.md` (not current). Update this file in every PR that changes project state; keep it short and keep "Last updated" to one line.

Last updated: 2026-10-29, `origin/main` at `68079d6`.

## 1. Current state

Fluxkit is a white-label e-commerce template: TypeScript monorepo, NestJS + Drizzle/Postgres, Meilisearch, Redis/BullMQ, Next.js storefront, React/Vite admin SPA served under `/admin-ui/`. Migrations `0001` to `0009`. Quick start: `README.md`.

- **Core commerce (complete):** catalog (ADR 0006), auth and roles, pricing and inventory, cart, checkout, orders, customers, scheduler jobs (`docs/api/jobs.md`). Open review follow-ups: `docs/plans/2026-10-16-catalog-review-findings.md`, `docs/plans/2026-10-18-cart-orders-review-fixes.md`.
- **Storefront v1 (complete):** catalog, cart, accounts, checkout, order pages, delivery step, payment pages, emailed-link pages, "Your data" page, legal placeholders. Playwright e2e (`@playwright/test` 1.64.1).
- **Admin UI v1 (complete):** catalog, prices and stock, orders, customers, users, media upload (ADR 0028), Shipping, Email, payment panel and attention list, Personal data and Audit log areas.
- **Shipping (built, not live-verified):** ADR 0029, methods, rates, shipments, tracking job 8. Providers: test-only `fake` and `nova_post` (ADR 0030, new Nova Post API); the latter is tested against a local stub only, and production answers its label request `422`. Fulfilment is manual. Plans: `docs/plans/2026-10-24-shipping.md`, `docs/plans/2026-10-25-nova-post-plugin.md` (both reviewed, fixes merged).
- **Email (built, not live-verified):** ADR 0031, outbox, jobs 9 and 10, password reset, optional verification, order and shipment mails, admin Email area. Providers: `fake`, `resend` (stub only, never reached Resend). Plan `docs/plans/2026-10-26-email.md`, review `docs/plans/2026-10-28-email-review.md` (fixed, #164).
- **Payments (built, not live-verified):** ADR 0032, payment attempts, signed webhook, reconcile job 11, refunds (`payments.refund`), storefront and admin UI, e2e with the fake. Providers: `fake`, `monobank` (stub only). Plan `docs/plans/2026-10-26-payments-monobank.md`, review `docs/plans/2026-10-29-payments-review.md` (F1 to F4 fixed, #173).
- **Privacy (built, legal review pending):** ADR 0033 and 0035, data inventory with CI guards, export, self-service deletion, admin erasure, job 12 `anonymise-orders` (off until `ORDER_CONTACT_RETENTION_DAYS` is set), audit log, legal page placeholders, operator guide `docs/privacy/README.md`. Plan `docs/plans/2026-10-29-privacy.md`, API review `docs/plans/2026-10-29-privacy-review.md` (F1 to F7 fixed). Steps 9 to 12 (UI, docs, e2e) have no independent review yet.
- **Search (partial):** plan `docs/plans/2026-10-29-search.md`, steps 1 to 3 merged (#175): spike S1, ADR 0034, pure core rules with vendored Snowball stemmers. Nothing is wired: no migration, no config, no indexer, no route, no UI. No open search PR.
- **Deployment (example, partly verified):** root `Dockerfile` (targets api, storefront, edge), `infra/docker-compose.prod.yml`, `infra/proxy/` (nginx, Caddy), `infra/production.env.example`, `pnpm check:env`, CI job `deploy-smoke` (`scripts/deploy-smoke.sh`). Plan `docs/plans/2026-10-29-production-deploy.md` still says "proposed" and `docs/deployment.md` does not exist; no real TLS, DNS or host was tried.
- **Tooling and CI:** root scripts: `build typecheck lint format format:check check:boundaries check:env test test:e2e db:migrate seed admin:create admin:unlock jobs:run-once openapi:export check:licenses check:docs notices feature-matrix audit:prod`. CI jobs (`.github/workflows/ci.yml`): `verify`, `feature-matrix`, `e2e`, `policy`, `docs`, `compose`, `deploy-smoke`. Matrix modes (`scripts/feature-matrix.sh`): `on off deleted providers-on providers-off providers-deleted providers-nova-post providers-email-{none,fake,resend} providers-payment-{none,fake,monobank}`.
- **Open PRs:** only Dependabot bumps (#166 to #170: swc/core, swagger, bullmq, dependency-cruiser, next).
- **Not built:** live provider verification (all three plugins ran against stubs only), search beyond the core rules, LiqPay/WayForPay, returns, admin email flows, two-factor, rate limits on catalog routes.

## 2. Next steps (in order)

1. Search plan steps 4 to 12 (`docs/plans/2026-10-29-search.md`): migration and config are red zones (approval), then enqueue hooks, indexer, store and admin routes, UI, e2e, independent review.
2. Independent review of privacy steps 9 to 12 (storefront and admin UI, docs, e2e); fixes in a separate PR.
3. Production deployment: owner approval of the plan, an independent review of the images and proxy, write `docs/deployment.md` (promised by the plan, referenced by the privacy review), then a dry run on a real host.
4. Live provider checks once the owner supplies keys (section 3).
5. Launch blockers: rate limits for the catalog routes of `/store/*` (needs a dependency, red zone); decide whether Swagger UI and `/docs-json` stay public in production; `TRUST_PROXY` set to the exact hop count (ADR 0026); check per-address limits from two networks after deployment.
6. Auth follow-ups, each with its own plan: session token rotation, Redis-backed login throttle (also for the in-memory reset and verification limits), two-factor.
7. Smaller follow-ups from the reviews: catalog items (C5, surviving mutations, `variant.title` is never written, `requiredText` in the store serializer); optional `CHECK (reserved <= 1000000000)` on `inventory_level`; merge or close the Dependabot PRs.

## 3. Owner-only actions

Agents must not do these (AGENTS.md is the owner's file) or cannot (keys, contracts, lawyers).

**AGENTS.md edits (collected from the plans, `CHANGELOG.md` and the old handoff):**
- Section 1, root scripts: `pnpm test:e2e`, `pnpm jobs:run-once`, `pnpm check:env`, `pnpm search:reindex` (once built). Tooling line: Playwright is set up for storefront and admin, no longer "planned".
- Section 1, configuration: `SCHEDULER_ENABLED`, `SCHEDULER_INTERVAL_SECONDS`, `ORDER_TOKEN_SECRET`, `MAX_OPEN_ORDERS`, `TRUST_PROXY`, `ADMIN_DEV_API_URL`; e2e-only `E2E_DATABASE_URL`, `E2E_PORT`, `E2E_API_PORT`, `E2E_STOREFRONT_PORT`, `ADMIN_E2E_PORT`, `ADMIN_E2E_API_PORT`; `SHIPPING_PROVIDERS_ENABLED`, `NOVA_POST_API_KEY`, `NOVA_POST_ENVIRONMENT`; `EMAIL_PROVIDER`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `STOREFRONT_PUBLIC_URL` (also read by the API), `RESEND_API_KEY`, test-only `FAKE_EMAIL_CAPTURE_FILE`; `PAYMENT_PROVIDERS_ENABLED`, `MONOBANK_TOKEN`, test-only `FAKE_PAYMENT_ADOPT_WEBHOOKS`; `ORDER_CONTACT_RETENTION_DAYS`, `STOREFRONT_REQUIRE_LEGAL_TEXT` (build time); search variables once merged (`SEARCH_ENABLED`, `MEILI_URL`, `MEILI_API_KEY`, `MEILI_INDEX_PREFIX`).
- Section 1, Stack and first market: Nova Post via the new REST API (ADR 0030); transactional email (ADR 0031); online payments (ADR 0032); the search decisions of ADR 0034 replacing the ADR 0005 pointer; deployment now exists as an example.
- Section 2.1 (core includes transactional email, the payments port, the search index and queue), section 2.3 (the price table sentence mentions a customer group the schema does not have, ADR 0012), a personal-data rule (inventory classification; no personal data in logs, events or URLs; see the privacy plan's list), section 6 Definition of done (personal data classified), section 11 (mail links only from `STOREFRONT_PUBLIC_URL`; webhook verification over the raw body; erasure needs the password; the search engine is never reachable from browsers), section 15 (legal placeholders; a production build refuses them).
- Section 5 layout: `packages/providers` holds `_fake`, `nova-post`, `_fake-email`, `resend`, `_fake-payment`, `monobank`; `docs/privacy/`; `apps/api/src/privacy/`; `infra/` holds the production example and proxies.
- Section 16: `@playwright/test` 1.64.1 (storefront, admin) and `react-router` 8.4.0 (admin); the LGPL-3.0-or-later exception for `@img/sharp-libvips-*` widened to API image re-encoding (media plan; reasons in `scripts/license-policy.json`); vendored Snowball (BSD-3-Clause, `docs/dependencies.md`); Resend, Monobank and Nova Post as external services and processors.
- Section 18: CI jobs `e2e` and `deploy-smoke`, `check:env` in `verify`; the matrix modes listed in section 1 above, plus `search-on|off` once built.

**Live checks that need the owner's keys or go:**
- Resend S1 (`scripts/spikes/resend-verify.mjs`, a test API key in the environment only) and the Reply-To assumption (plugin README, R3).
- Monobank S1 and S2 (`packages/providers/monobank/README.md`, "Plan S1"): a TEST token as `MONOBANK_TOKEN`, a public `https` staging URL for the webhook. How an external partial refund is reported, and whether Monobank refuses an over-refund, are unverified (payments review F1).
- Nova Post: a real pickup-point order for the label (production answers `422`), the estimate, and status codes other than `1` and `2` (`docs/plans/2026-10-25-nova-post-plugin.md`); a sandbox key for a Ukrainian account; whether production shipments are billed.
- **Rotate the Nova Post key that was pasted into a chat earlier.**
- A verified sending domain (SPF, DKIM, DMARC) for `EMAIL_FROM`; a Monobank merchant contract for production.

**Legal and business:**
- Privacy tasks O1 to O8 (`docs/plans/2026-10-29-privacy.md`, `docs/privacy/README.md`): GDPR applicability and EU representative; processor or controller status and DPAs for Resend, Nova Post, Monobank and the host; final privacy, terms and cookie texts; identity check for requests by email; retention periods and required order fields; RoPA and Commissioner notice; transfer mechanisms; breach contacts.
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

- ADR 0006 vs code: default page size (admin 50, store 24, ADR says 24) and the category filter on admin products (direct assignments only). Fix the code or supersede the ADR. Sign-off wanted on ADR 0008 (required variant attributes asked only of active variants at publish).
- The typed client generator `openapi-typescript` is not used (its peer range excludes TypeScript 6.0.3); `@fluxkit/api-client` is hand-written with contract tests. `"sideEffects": false` for `@fluxkit/core` is not approved. `@axe-core/playwright` (MPL-2.0) is not approved.
- The admin product search by slug is a table scan; a `text_pattern_ops` index needs a migration. Title search arrives with the search plan.
- Nova Post choices where the evidence was silent (ADR 0030, plan step 7b): `ids[]` filter for `findPickupPoint`, no `PUDO`, capped list pages, no address delivery. A note superseding ADR 0029 decision 9 in part may be wanted (architect).
- Per-area known-gap lists (storefront, admin, shipping, email, media, cart and orders) are in `docs/HISTORY.md`; the maintained copies are in `apps/storefront/README.md`, `apps/admin/README.md`, `docs/api/shipping.md`, `docs/api/media.md` and `docs/plans/2026-10-18-cart-orders-review-fixes.md`.
- Limits worth knowing: in-memory rate limits are per API process (run one API instance); append-only journals can be bypassed by `TRUNCATE` or plain SQL at database-privilege level; order headers are not immutable at the database level; the example proxies are exercised only by `deploy-smoke` and the e2e proxies, never on a real host.

## 5. Working agreements (the owner's process)

- Plan first; data model, checkout, auth and payments go into `docs/plans/<date>-<slug>.md`. Decisions as a quiz: one question, three options, recommended first; no questions about trivia. Standing grant (2026-10-29): take the recommended options without asking.
- Independent review by a different agent, ideally a different model, for each plan; fixes in a separate PR with a regression test.
- TDD for money, stock and security rules, with failing-then-passing evidence; mutation checks on the rules that matter. Never mask failures: no skipped tests, no `any` or `@ts-ignore`, no weakened lint.
- Verify agent work yourself: run each check separately and read its exit code. Report what was NOT verified.
- Merge when CI is green (orchestrator, under the owner's autonomy grant); red zones (dependencies, migrations, public contracts, payments/auth/pricing, moving core and features, destructive commands) still need approval.
- Secrets never in chat, files, logs or commits; keys go to the environment only.
- Roles and models: `docs/AGENT_WORKFLOW.md`. The owner talks in Russian; code, docs and commits are English; branches `feature/`, `fix/`, `chore/`, `docs/`.

## 6. Run it locally

- Quick start and the checkout walkthrough: `README.md`. Integration tests need real Postgres (database name ending `_test`), Redis and Meilisearch, and fail without `DATABASE_URL`, `REDIS_URL`, `MEILI_URL`, `MEILI_MASTER_KEY`; run `pnpm test` in a subshell with them exported.
- Browser tests: `pnpm test:e2e` (separate `*_e2e_test` database in `E2E_DATABASE_URL`, wiped per suite; `apps/storefront/e2e/README.md`, `apps/admin/e2e/README.md`).
- Full local check set: `pnpm lint`, `format:check`, `typecheck`, `check:boundaries`, `check:env`, `test`, `check:licenses`, `audit:prod`, `check:docs`, `pnpm --filter @fluxkit/api db:drift`, `openapi:export`.
- Use the test database from one process at a time. In the cloud sandbox there is no Docker daemon (services run natively) and `gh pr create` fails; use `gh api repos/Klukvas/fluxkit/pulls`. Agent worktrees in `.claude/worktrees/` are git-ignored.
- Conventions: Node 22, pnpm 10.28, TypeScript pinned to 6.0.3; NestJS is ESM (`.js` in relative imports); `packages/core` is pure (no Nest, Drizzle, I/O); schema changes need a hand-written `.down.sql`; errors are `application/problem+json`; texts are JSONB locale maps; storefront and admin call the API on their own origin (ADR 0026, 0027).
