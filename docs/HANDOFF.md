# Handoff: current state and how we work

Read this first when you pick up the project (Claude Code, Codex, or a human). It says where we are, what is next, and the working agreements that are not obvious from the code.
Rules live in `AGENTS.md`; decisions in `docs/adr/`; plans in `docs/plans/`. This file is the short bridge between them.

**Update this file in every PR that changes project state** (a PR merged, a step finished, a decision taken, a new working agreement). Last updated: 2026-10-26 (email plan step 2 on `feat/email-core`, PR not opened: core `src/email/` (pure, test first: `EmailProviderPort` and `EmailProviderResult` with `quotaPeriod`, `checkEmailProviderContract`, `validateOutgoingEmail`, ASCII-only header-safe address, display-name, mailbox and subject checks, `escapeHtml` and the `html` tag with `unsafeRawHtml`, the customer auth token derivation over the `HmacSha256` port and `evaluateAuthToken`, statuses and transitions as data, `nextEmailAttempt` and deadlines, the template contract with `render` returning `SafeHtml`, `buildEmailDedupeKey`), `emailTheme` in `@fluxkit/theme` as part of the token contract (ADR open question 7 decided), dependency-cruiser rule `core-must-not-import-node-builtins`; decisions in the plan's step 2 row; no schema, route, dependency or variable change. Before that, email plan step 1: ADR 0031 "Transactional email" merged as #134: core `EmailProviderPort` and `EmailProviderResult`, one provider by `EMAIL_PROVIDER` (`none` default, `resend`, `fake`) through the generalized manifest scan, the dedicated `email_message` outbox (not `domain_event`) with claim, send and record outside transactions, the message id as idempotency key and a 12 h deadline inside Resend's 24 h window, 30/90-day retention without bodies or tokens, `customer_auth_token` with HMAC-derived tokens (own label on `ORDER_TOKEN_SECRET`, hash-only storage), password reset, optional verification, five order mails, `404` plus `emailDelivery` flags without a provider, links from `STOREFRONT_PUBLIC_URL` with the token in the fragment, the template contract and `emailTheme`, `email.manage`; ten open questions in the ADR's last section (verification mail deadline and locale, `admin.test` locale, monthly quota, pacing, Resend UNKNOWNs). Before that, the transactional email plan `docs/plans/2026-10-26-email.md` merged as #133 with the owner's quiz answers (recommended options; the other questions taken as recommended). Before that, the independent review of the Nova Post plugin, `docs/plans/2026-10-25-nova-post-plugin-review.md` (no blocker, two major, five minor, three nits), and its fixes on `fix/nova-post-review` (this PR; each finding's resolution in the review's table): `findWaybill` answers `unavailable` `list_changed` instead of a false `null` when the shipment list shifts while it is paged; a city's point list has its own time budget (no page started after 3.5 s, pages in flight abandoned at 4.5 s, the first branch and locker pages read together) and answers the points read instead of failing at the API's 5 s limit; a create's `422` naming no field is `unavailable` (reconcile), a label's field-keyed `422` is `rejected`; carrier error keys are kept only when they look like field paths; a create whose authorization fails before the `POST` carries the new core code `not_sent` and the API settles it `failed` instead of `unknown`; the recipient name needs two words; a stricter stub carrier, specs for the surviving mutations, the status code `124` confirmed absent from the documented table, realistic order numbers in fixtures, and the `providers-nova-post` matrix mode now checks that no request goes to Nova Post at startup. No schema change, no new dependency. Before that, shipping plan step 7b merged as #131: the Nova Post plugin `packages/providers/nova-post` (code `nova_post`, plan `docs/plans/2026-10-25-nova-post-plugin.md`) implements the whole port against a local stub carrier (tests never reach the network); port changes `fetchLabel` with the waybill number, `track` may ignore phones, `validateSettings` applied by the admin settings route; core `checkShippingProviderContract` shared with the fake; variables `NOVA_POST_API_KEY` (required when enabled) and `NOVA_POST_ENVIRONMENT` (`sandbox` default) parsed by the plugin; matrix mode `providers-nova-post`; the 21:50 UTC production rerun of step 7a recorded in the shipping plan (division facts, `ids[]` filter, tracking shape; the label still answers `422`). Before that, shipping plan step 7a ran on production with the owner's key and go, findings recorded on `chore/np-findings` (merged as #130): readonly and write stages done; two shipments created and deleted, account clean; no idempotency (a repeat create makes a second shipment), `clientOrder` echoed and found by paging `GET /shipments` (newest first), `ids[]` takes the create answer's uuid, delete by id only, UA numbers 14 digits, raw JWT only (`Bearer` is `401`), times ISO UTC, settlement names need `Accept-language`; not done: the label (the tool sent `type[]=marking`, the API wants `type=marking`), H30 and the division facts (the tool chose a settlement without divisions); both tool bugs fixed, a rerun needs the owner's go; owner decision: production runs allowed with an explicit go per run; plan section "Spike 7a — production run 2026-10-25". Before that, the re-plan merged as #129: shipping plan steps 7a and 7b re-planned for the new Nova Post API on `chore/np-v1-replan`, PR not opened: the owner's key belongs to the new REST API `https://api.novapost.com/v.1.0` (JWT from `GET /clients/authorization`), not to the legacy JSON-RPC API; owner decision: build the plugin on the new API, ADR 0030 (supersedes ADR 0029 decision 11 and the Nova Poshta parts of decisions 7 and 8); the shipping plan's section 8 maps every old "from memory" item to the official documentation with citations, maps the port operations to routes (8.3), lists the sender profile and the owner's preparation (8.4), the 7b design (8.5), the key-less findings of the new API (8.6: real HTTP statuses, `{errors: {...}}` bodies, an invented key answers `422 "API key expired"`, a missing token `401 "Invalid token"`, both sandbox hosts answer, `/test-api-keys` answers on production too) and the UNKNOWN list (8.7); the new tool `scripts/spikes/nova-post-verify.mjs` (sandbox by default, write refuses production without `--allow-production-write`, hypotheses H01 to H35); the legacy tool is kept and marked deprecated. Before that, the legacy step 7a preparation merged as #128 (`chore/np-spike-prep`: the Nova Poshta check tool `scripts/spikes/nova-poshta-verify.mjs` with stages `keyless`, `readonly` and `write --confirm` and a `--self-test` (`scripts/spikes/README.md`), and the key-less findings in the shipping plan, section "Spike 7a — key-less findings": key errors answer HTTP 401, not 200; error texts are English; tracking works without a key, at most 100 numbers; status codes are digit strings; everything that needs a key is still unverified. Before that, the step 13 review fixes and the step 12 docs sweep merged as #127. Earlier: shipping plan step 12, the docs sweep, and the fixes of the step 13 independent review on `fix/shipping-review`, PR not opened; review and resolutions: `docs/plans/2026-10-24-shipping-review.md`): the checkout's `shipping_method_required` switch counts only OFFERED methods (active, in `SHOP_CURRENCY`, a pickup point method only with its provider loaded; the options list uses the same filter and no longer lists a pickup point method of an unloaded provider; a startup warning names such methods) (M-1); `findWaybill` takes an ISO 8601 UTC instant window instead of a UTC date and a "not found" settles an unknown shipment as `failed` only after 5 minutes, younger ones answer `409 reconcile_too_early` (M-2); the provider connection check goes through `callProvider` (m-1); directory caches keep empty lists and unknown point refs apart and briefly, the point cache is bounded by 100 000 points, one gate slot is reserved for the checkout and a slot is held until the provider call ends (m-2, m-3); a request shaped for another kind is `409 shipping_changed` (m-4); `SHIPPING_PROVIDERS_ENABLED=fake` is refused when `NODE_ENV=production` (m-5); tests for the method-delete race and an unloaded tracking provider (m-6, m-7); docs sweep (m-8); three inactive demo methods in `pnpm seed` (m-9); m-10 and the nits deferred. No migration, no new dependency; one new problem rule (`reconcile_too_early`), one internal port change (`WaybillLookup`) and one configuration refusal. Before that, shipping plan steps 1 to 6, 8, 10 and 11 were merged as #118 to #126 (plan #117), the media upload plan as #103 to #109 and its review fixes as #112, the admin UI plan as #81 to #101; the history of earlier states is in the git log of this file.

## Where we are

Fluxkit is a white-label e-commerce template: own TypeScript core, NestJS + Drizzle/Postgres, Meilisearch, Redis/BullMQ, a Next.js storefront and a React/Vite admin SPA served under `/admin-ui/` (ADR 0027). See `README.md` and `AGENTS.md`.

| Area | State |
|---|---|
| Monorepo scaffold, CI, licenses, docs | Complete (plan `2026-10-14-monorepo-scaffold.md`; PRs #1 to #5, docs PR #10). |
| Catalog `2026-10-14-catalog.md` | Complete: steps 1 to 8, review fixes #27 to #29. Open items: `2026-10-16-catalog-review-findings.md` (C5, information items, surviving mutations). |
| Auth and roles `2026-10-16-auth-and-roles.md` | Complete: PRs #31 to #37 (ADR 0010). |
| Pricing and inventory `2026-10-16-pricing-and-inventory.md` | Complete: PRs #40 to #48 (ADRs 0011 to 0014). |
| Cart, customers and orders `2026-10-17-cart-and-orders.md` | Complete: PRs #49 to #64 (ADRs 0015 to 0025). Review follow-ups below. |
| Storefront v1 `2026-10-18-storefront.md` | Complete: steps 1 to 10 merged (PRs #66 to #79; #78 is the step 9 docs sweep, #79 the step 10 review fixes). No online payment and no search: orders stay `awaiting_payment` until an admin marks them paid or they expire. |
| Admin UI v1 `2026-10-19-admin-ui.md` | Steps 1 to 12 merged (#81 to #95). Step 13 merged (#101): independent review (no High, one Medium, seven Low) and its fixes. Step 2b (media upload, its own plan) merged as #103 to #109, review fixes #112. |
| Shipping `2026-10-24-shipping.md` (ADR 0029) | Steps 1 to 6, 8, 10, 11 merged (#118 to #126; step 9 inside 5, 6, 8). Step 13 review done (`2026-10-24-shipping-review.md`); its fixes and step 12 (docs sweep) merged as #127. The legacy step 7a tool merged as #128; ADR 0030 retargets the plugin to the new Nova Post API and the plan's section 8 and steps 7a/7b are rewritten (#129). Step 7a ran on production 2026-10-25 and was rerun the same evening (findings in the plan). Step 7b (the Nova Post plugin) merged as #131; its independent review (`2026-10-25-nova-post-plugin-review.md`) found no blocker and two major findings, fixed on `fix/nova-post-review` (this PR). Fulfilment is manual. |

Not built: payment providers, a carrier plugin verified end to end against the real carrier (shipping works end to end with the test-only `fake` provider: methods, store options and lookups, the checkout's shipping step, shipments with reconcile, labels and tracking job 8, the storefront delivery step and order tracking, the admin Shipping area and shipment panel; the Nova Post plugin `nova_post`, plan step 7b, is built and tested against a local stub only: its label request is refused by production for now, its estimate and most status codes are unverified), email delivery, search, and a production deployment (no API or storefront image; the admin is static files that the edge proxy serves, see `README.md`, Deployment notes). Image upload exists end to end (`docs/api/media.md`, `docs/api/jobs.md`, `apps/admin/README.md`, `README.md` "Uploaded images"); its review fixes are merged (#112).

## Admin UI plan status

| Step | What | PR |
|---|---|---|
| plan | Plan approved and merged | #80 |
| 1 | ADR 0027 (SPA under `/admin-ui/` on the storefront origin) | #81 |
| 2 | Additive admin API (nine items, no migration) | #82 |
| 3 | `createAdminClient` in `@fluxkit/api-client` | #83 |
| 4a | Admin components in `@fluxkit/ui` | #84 |
| 4b | SPA shell, router, permission table (`react-router` 8.4.0) | #85 |
| 5 | Catalog dictionaries | #86 |
| 6a | Products: list, create, editor shell, General, Attributes, Categories, lifecycle | #87 |
| 6b | Products: Media, Options, Variants | #88 |
| 7 | Products: Prices and Stock | #89 |
| 8 | Orders | #90 |
| - | Explicit Vitest timeout for the admin suite | #91 |
| 9 | Customers | #92 |
| 10 | Admin users (owner only) | #93 |
| 11 | Admin end-to-end suite `apps/admin/e2e`; root `pnpm test:e2e` runs both suites | #94 |
| 12 | Docs sweep | #95 |
| 13 | Independent review by a different agent than the authors: done; fixes of M1, L1, L3 to L7 (plan, "Step 13 review outcome"); L2 kept as a known limitation | #101 |
| 2b | Media upload (storage, upload endpoint, its own plan and ADR first) | plan merged (#102, `docs/plans/2026-10-23-media-upload.md`); ADR 0028 (step 1, #103), `sharp` 0.35.5 (step 2, #104), the core rules and `MEDIA_*` configuration (step 3, #105), the API with the api-client method (steps 4 and 6, #106) and the cleanup job (step 5, #107) merged; step 7 (admin UI, #108) and step 8 (proxies, e2e, deployment notes, #109) merged; step 9 review done, fixes merged (#112) |

The first CI run of `main` after #94 (commit `a4f1a52`, which includes the `e2e` job with both suites) was still in progress when this file was written. Its result is not recorded here; check it before relying on the e2e suites in CI.

## Next steps (in order)

1. The media upload plan is complete (plan `docs/plans/2026-10-23-media-upload.md`, ADR 0028; steps 1 to 8 merged as #103 to #109, the independent review and its fixes as #112). Open for the owner: the AGENTS.md section 16 edit for the libvips scope and the notices gap (Open decisions). Open Dependabot PR #97 (`@playwright/test` 1.56.1 to 1.64.1): its admin e2e run fails at the guard's "requests, CSRF and CSP" assertion with the newer Chromium (revision 1248, the sandbox has 1194); the guard needs adapting before the bump.
2. Then, each with its own plan and owner approval: payment providers and the first Ukrainian providers (LiqPay, WayForPay, Monobank, Nova Poshta; orders are marked paid by hand until then), shipping providers, email delivery (password reset, email verification, order mails), search indexing (blocked by ADR 0005, see Open decisions), and a privacy plan before the EU launch (not written yet).
   - Email: plan `docs/plans/2026-10-26-email.md` (approved, merged as #133). Step 1, ADR 0031 `docs/adr/0031-transactional-email.md`, merged as #134. Step 2 (core `src/email/`, `emailTheme`) done on `feat/email-core` (PR not opened; decisions in the plan's step 2 row, among them ASCII-only mail addresses: steps 5 or 7 decide what an account with a non-ASCII address gets). Next: step 3 (migration `0007_email`), then step 4. Owner actions: a Resend account and sending-only key for S1 (step 6), a verified sending domain, Resend's processor terms and data region (R18).
   - Shipping: plan `docs/plans/2026-10-24-shipping.md` (ADR 0029). Steps 1 to 6, 8, 10 and 11 merged (#118 to #126); decisions of each step are in its row of the plan's step table (stale window 72 h past expiry, cache sizes and limits, `store_pickup` country rule, `findPickupPoint`, no `OrderFulfilmentPort`: fulfilment stays manual, the create's three outcomes, the 2-minute stale `pending`, job 8 backoff). Step 13 (independent review) found no blocker, two major and ten minor findings; the fixes are on `fix/shipping-review` with the step 12 docs sweep (PR not opened). Merged as #127. **Step 7b (ADR 0030) merged as #131** (plan `docs/plans/2026-10-25-nova-post-plugin.md`); its independent review `docs/plans/2026-10-25-nova-post-plugin-review.md` is resolved on `fix/nova-post-review` (this PR). **Remaining for the owner:** a live run with the owner's go (a real pickup point order: the label, which production answers `422 "Internal Server Error"` for the documented request, H27/H30; the estimate, never answered `200`, H18; status codes other than `1` and `2`); a Ukrainian sandbox key (H34); whether production shipments are billed (H33); the AGENTS.md lines below. The legacy tool `nova-poshta-verify.mjs` is deprecated. Open for the owner: review m-10 (Open decisions).
3. Launch blockers still open: rate limiting for the catalog routes of `/store/*` (needs a dependency, red zone); decide whether Swagger UI and `/docs-json` stay public in production; the edge proxy in every deployed environment (`README.md`, Deployment notes; the examples are not tested in this repository, the e2e proxies `apps/storefront/e2e/proxy.ts` and `apps/admin/e2e/proxy.ts` are the tested routing references), `TRUST_PROXY` set to the exact hop count (ADR 0026); check the per-address limits from two networks after deployment.
4. Auth follow-ups (each needs its own plan): audit log, session token rotation, Redis-backed login throttle, two-factor, password reset by email.
5. Tooling: `pnpm db:migrate` (forward only; rollbacks are manual through `drizzle/NNNN_name.down.sql`), `pnpm seed`, `pnpm admin:create`, `pnpm admin:unlock` and `pnpm jobs:run-once` exist; there is no migration status or rollback command yet.
6. Smaller follow-ups from the reviews: the catalog items (C5, tests for the surviving mutations, the `variant.title` column that no route writes, the public attribute definition's display name in the serializer, `requiredText` in the store serializer); pricing (optional migrations `CHECK (reserved <= 1000000000)` on `inventory_level` and a statement-level `TRUNCATE` trigger on `stock_movement`, ADR 0012 and 0013; each needs its own approval).

## Open decisions (owner)

- **Shipping review m-10: a paid order with an active waybill can still be cancelled** (`paid -> cancelled` releases the stock; the shipment and job 8's polling are not touched; the admin must cancel the waybill by hand). Options: refuse cancel (`409 rule_violation shipment_active`) while a shipment is active, warn in the admin UI only, or keep it documented. Deferred by the step 13 fixes (no order status change without an owner decision).

- **Nova Post (ADR 0030):** decided 2026-10-25: the spike's write stage may run on production with the owner's explicit go per run (`--allow-production-write`). Plan step 7b decided where the evidence was silent (owner may revisit): `findPickupPoint` uses the undocumented `ids[]` filter and fails closed; `PUDO` partner points are not offered; a city list reads branches first and at most 15 pages (the biggest cities show only part of their lockers in the picker); no address delivery; the estimate only for a UAH shop's pickup point; `findWaybill` reads at most 10 pages of 100 shipments, then answers "could not tell"; the label stays best effort. The port changes of 7b (and the ADR 0029 deviations of the step 13 review) may want a note superseding ADR 0029 decision 9 in part (architect). Still open: whether Nova Post issues a sandbox key for a Ukrainian account (the docs say "UA key generation is currently not supported"); whether creating or deleting production shipments is billed (ask the manager); the legal terms for storing directory data (ADR 0029 open question 6 still open).
- **`AGENTS.md` (the owner's file) is behind the code.** The owner adds these lines:
  - Section 1, root scripts: `pnpm test:e2e` (builds, then the storefront suite and the admin suite `apps/admin/e2e`; not part of `pnpm test`) and `pnpm jobs:run-once`.
  - Section 1, configuration: `SCHEDULER_ENABLED`, `SCHEDULER_INTERVAL_SECONDS`, `ORDER_TOKEN_SECRET`, `MAX_OPEN_ORDERS`, `TRUST_PROXY`, `ADMIN_DEV_API_URL` (development only), and the suite-only variables `E2E_DATABASE_URL`, `E2E_PORT`, `E2E_API_PORT`, `E2E_STOREFRONT_PORT`, `ADMIN_E2E_PORT`, `ADMIN_E2E_API_PORT`.
  - Section 1, tooling: change "Playwright (e2e) is planned, not set up yet": it is set up for the storefront and the admin.
  - Section 16: `@playwright/test` 1.56.1 in `apps/storefront` and `apps/admin` (approved 2026-10-18 and 2026-10-19), and `react-router` 8.4.0 in `apps/admin` (approved 2026-10-19). See `docs/dependencies.md`. Also (media upload, owner answer 2, ADR 0028): the LGPL-3.0-or-later exception for the `@img/sharp-libvips-*` binaries widened to API image re-encoding, in AGENTS.md section 16 and the reasons in `scripts/license-policy.json`; needed before plan step 2.
  - Section 18: the CI job `e2e` runs both suites.
  - Section 1, first market (ADR 0030): Nova Post is reached through the new REST API (`https://api.novapost.com/v.1.0`, JWT), not the legacy Nova Poshta API 2.0; the plugin is `packages/providers/nova-post` (code `nova_post`, built in step 7b). Section 1 lists `NOVA_POST_API_KEY` (required when `nova_post` is enabled) and `NOVA_POST_ENVIRONMENT` (`sandbox` or `production`, default `sandbox`) with the other configuration; section 5 lists `packages/providers` as holding `_fake` and `nova-post`; section 18 lists the matrix mode `providers-nova-post`.
  - `ADMIN_E2E_PORT` and `ADMIN_E2E_API_PORT` are in `.env.example` since media plan step 8.
- **Third-party notices carry no licence texts** (media step 9 review L-5, owner and legal): `pnpm notices` lists name, version, licence and homepage only; the LGPL-3.0, GPL-3.0 and Apache-2.0 texts are not included (the libvips packages ship no LICENSE file), and the libvips bundle contains cairo (MPL-1.1) and aom (BSD-2-Clause plus the AOM patent licence), which the policy does not name. Details and the decision to take: `docs/dependencies.md`, "Notices gap found by the media step 9 review".
- **Shipping step 5 gaps (owner/architect):** closed in part by step 7b: the port has `validateSettings`, applied by the admin settings route after the bounded check. No "API key present" probe was added: a provider that needs a key refuses to start without it (`nova_post` does), so an enabled provider always has one; "Test connection" says whether it works. Method rules the ADR left open and step 5 fixed: any `providerCode` must be an enabled provider when written or when the method is activated, a `pickup_point` provider must report the `pickupPoints` capability, `country_codes` is required for every kind (`store_pickup` included, the database requires it), and a PATCH of `pricing` re-stamps the method currency with `SHOP_CURRENCY`.
- **Typed store client generator:** `openapi-typescript` (MIT) is not used: its peer range `typescript ^5.x` excludes the pinned TypeScript 6.0.3. `@fluxkit/api-client` has hand-written types and contract tests against `docs/api/openapi.json`. Revisit when the generator supports TypeScript 6.
- **`"sideEffects": false` for `@fluxkit/core`:** the admin does not import core because one import pulls zod and the whole core (88.6 KB minified; 1.5 KB with the flag). An internal change to `packages/core` the orchestrator may approve; until then the admin copies constants and compares them in tests.
- **`@axe-core/playwright`** (MPL-2.0, dev tooling) for automated accessibility checks: not approved, not added.
- **Index for the admin product search:** the slug arm of `GET /admin/products?q=` is a table scan. An index `ON product (slug text_pattern_ops)` (a migration with a down script, red zone) would make it an index range scan. Not needed for a catalog of a few thousand products; the owner decides.
- **Storefront decisions taken where the plan was silent** (step 7; the owner may revisit): no billing address and no recipient fields at checkout; without `sessionStorage` the checkout attempt lives in memory with a visible warning instead of refusing.
- Ukrainian search morphology and variant-level facet counts (ADR 0005). They block the search plan, not the catalog.
- Branch protection on `main` (GitHub settings, owner side). Pinning GitHub Actions by commit SHA.
- Permanent negative test for the dependency-cruiser `core-must-not-import-infrastructure` rule.
- ADR 0006 (accepted) and the code differ on two points: the default page size (code: admin 50, store 24; ADR section 9: 24) and category filters (`?categoryId` on admin products matches direct assignments only; ADR section 8 says listings include descendants). Fix the code, or supersede the ADR; do not edit it.
- Owner sign-off still wanted on the core rule inside ADR 0008: required variant-level attributes are asked only of active variants at publish.
- Swagger UI and `/docs-json` in production (see Next steps 5).

## Known gaps (admin UI, steps 1 to 13, not fixed)

Catalog and products
- **Categories: the roots are found by paging the flat list.** `GET /admin/categories` cannot list the root level alone (`parentId` takes only a uuid). The tree pages the list (100 rows a request, at most 10 requests); above 1 000 categories it shows "list truncated" and may miss roots. An additive `parentId=null` filter (a public contract change, red zone) removes the workaround (`apps/admin/src/areas/catalog-dictionaries/category-tree.ts`, `collectRoots`). Tree expansion is lost when an editor is opened and left.
- **Product list search** is what the API offers: `q` is a slug prefix or an exact SKU (no title search until the search plan); the slug arm is the table scan above; the category filter matches direct assignments only (ADR 0006, open decision); brand names are read per distinct brand of the page (at most six at a time). The summary has no image, price, availability or variant count (gap 2, deferred).
- **Whole-set saves are last-write-wins.** The attributes (the whole product-level map), media, options, categories and a variant's attribute map are replaced as a whole, so two admins editing the same set at the same time overwrite each other. Prices are per cell (the last bulk save wins per cell). General fields and variant fields are per field. Owner answer 13 accepts this.
- **Variants and options cannot be reordered** (the API has `position`); they keep their stored order. The option names need one `GET /admin/options/{id}` per option (at most six at a time).
- **A click on a product tab while the product reloads after a write** can be lost when the tab remounts.

Prices and stock
- A price field never takes a comma as the decimal separator (refused with a message).
- More than 500 changed prices are refused in one save (the API's all-or-nothing limit); they are not split.
- The stock adjustment form predicts the stock rules from the last read; the server decides under its row lock.
- No idempotency key on admin writes (owner answer 12): after a lost stock adjustment answer the journal check can say that a new movement by you appeared, not that it is the one sent (two tabs of one admin can confuse it). The screen never retries.
- Reservation links open `/orders?q=<order number>`.

Orders
- The date filter reads days in the browser's time zone (no shop time zone, plan gap 18): one shared URL can show different orders to admins in different zones.
- The search is an exact order number or an exact email only (the API's rule); the list is newest first only.
- Mark paid records the full total only (owner answer 8). After a lost mark-paid answer the page checks the reference and the admin decides whether to retry with the same reference. After a lost mark-fulfilled or cancel answer the page only reloads (a repeat would be refused as `invalid_transition`).
- Managers see "another admin" with a short id in the history (owner answer 11).

Customers and admin users
- The customers list has no lock state, no order count and no status filter (the API offers none); the only filter is the start of an email. The lock is a flag without a time (the API never sends `lockedUntil`). An admin cannot create or delete a customer, change an email or set a password (no route). Activating a customer again does not restore the sessions deactivation deleted.
- A lost customer or user answer is told by the stored state, which cannot prove that this very request landed (another admin may have done the same). A lost password reset cannot be told from the stored user.
- The users list has no search, filter or lock state; there is no delete (deactivate instead) and no email change. After a lost create answer only the first 1 000 users are checked for the email. After resetting the own password the `401` failure shows under the status line until the owner signs in again.

Shell, i18n, images and e2e
- **CSP and images:** the admin CSP allows `'self' data:` and the configured `STOREFRONT_IMAGE_HOSTS`. The seed's images live on `example.com`, which the admin CSP refuses; the screens say so in text, and the e2e guard accepts exactly those refusals. Brand logos and product images from other hosts are not shown.
- **Example proxies:** since media plan step 8 the nginx locations and the Caddy matcher in `README.md` accept the bare prefixes (`/admin`, `/store`, `/media`) like the e2e proxies (reasoned, not run against a real nginx or Caddy), and they route `/media/*` to the API with nginx `client_max_body_size 12m` on `/admin`. Since the step 13 fixes the nginx example sends the immutable `Cache-Control` on successful asset answers only and shows where to repeat a server-level HSTS header; the Caddy example may still mark a 404 of a missing asset immutable (reasoned, not tried). Neither example is tested.
- **A user change made in another tab is not noticed** (step 13 review L2, kept by the owner): `me` is read again only after a sign-in through the re-sign-in dialog or after a 403. If the cookie changes to another admin through another tab of the same browser, an open tab keeps the old user's header, navigation and permissions until a 401 or 403, while its requests run as the new user (no escalation: same browser profile). A fix would read `me` again on `visibilitychange` or focus.
- Problem reasons the problem map does not list (`invalid_code`, `invalid_characters`, `locale_not_allowed`, `not_an_object`, `not_a_string`, and the attribute combination reasons the form prevents) show the generic message with the code in small print.
- `react-router` 8.4.0 requires Node `>=22.22.0` (`engines`). The repository pins Node 22 (`.nvmrc`); CI and the sandbox use the latest 22.x.
- **e2e (step 8 of the media plan):** the upload scenarios run through the e2e proxy with a temp `MEDIA_DIR`; not covered: the lost-answer path of an upload, the server's own `413` through the UI (the browser refuses an oversized file first), a real nginx or Caddy, 50 megapixel files, the storefront showing an uploaded image (it needs an `https` media host with a public address, see `README.md` "Uploaded images"). The bare `/media` and `/media/` 404 without `no-store` and `nosniff` is fixed by the step 9 review.
- **e2e (step 11):** Chromium only; no automated accessibility scan (`@axe-core/playwright` is not approved). Not covered in a browser: the lost-answer paths of the writes (the Vitest specs and the step smoke runs cover them), the owner's role change and password reset screens, the category delete, the product list filters, the reservations list with real orders, `vite dev`. The suite has been run locally; its first CI run is in the list above. See `apps/admin/e2e/README.md`, "Not covered".

## Known gaps (shipping step 13 review, deferred)

Recorded on purpose (`docs/plans/2026-10-24-shipping-review.md`, resolution column):
- m-10 (owner decision, above). Nits n-1 (coalesced estimates use the first caller's declared value; informational only), n-2 (a `stale: true` lookup is sent with `public, max-age=300`), n-3 (no CHECK ties `order_shipping.currency` to the order or `created` to a tracking number; a `returned` shipment blocks a new one), n-4 (a row whose transaction fails every tick stays first in job 8's due order).
- M-1 decided rule: an active method that the shop cannot offer (another currency, a pickup point of an unloaded provider) does not make a method required; one that does not serve the shopper's country still does; a hand-damaged `pricing` still does.
- m-3: a provider that ignores the abort signal keeps its gate slots until its calls end, so its lookups fail as unavailable meanwhile (at most 4 real calls per provider and process; the plugin rule is to honour the signal).
- A checkout that names a point another request is already looking up shares that lookup (and its place at the gate).
- The ADR 0029 deviations listed in the review (decisions 3, 5, 6, 7, 9, 10, 13) need a superseding ADR or note when steps 7a/7b change the port.

## Known gaps (shipping step 11, not fixed)

Recorded on purpose (`apps/admin/README.md`, "Shipping settings" and "Delivery and shipments on the order detail"):
- **No list of enabled carriers**: the API has no such route, so the Carriers page shows the carrier codes that the methods name (the first 100 methods) and opens another by its code; a route `GET /admin/shipping/providers` (an additive public contract, red zone) would give a real list, and with a probe for "the API key is present" the page could say whether the key is set. Until then the page only explains that keys are environment variables and offers "Test connection".
- **The carrier profile is a JSON text**, not a form: the carrier port has a validator since step 7b (`validateSettings`: the API names wrong fields) but no schema the screen could render. A schema member would let the screen render a real form.
- **The "result unknown" path of a create is not exercised in a browser**: the fake provider's `failNext` hook works inside the API process only, and the e2e API is a separate process. The unit and markup specs cover the three outcomes, the reconcile action and the absence of any retry; a real-carrier or a hook-over-HTTP test would close it.
- **Shipping e2e activates a method in a database shared with the other scenarios**: an active method makes plain guest checkouts fail with `shipping_method_required`, so every shipping scenario ends by switching all methods off (also on failure) and the suite runs on one worker. A parallel run would need its own database.
- **A shipment created by another admin shows as "another admin (id)"** for a manager (emails are read only with `users.manage`, owner answer 11), as in the order history.

## Known gaps (shipping step 10, not fixed)

Recorded on purpose (`apps/storefront/README.md`, "Delivery and shipping"):
- The comboboxes are tested as pure logic, as markup and in Chromium (keyboard, live region state); no screen reader was used. Only the fake provider (three cities, a branch and a locker each) exercised them: Nova Post lists are large (Kyiv: about 8 000 points; the plugin keeps all branches and part of the lockers, step 7b) and point names are Ukrainian in every language (only city names follow the language, spike rerun H14); the pickers have not run against the plugin in a browser.
- The delivery section re-reads the options on a country, city or point change and on every cart change (one `no-store` request each); there is no polling, so a price changed by the shop while the page is open is found at the submit (`409 shipping_changed`, which the page handles).
- A pickup point order shows the point once on the order page; the order's `shippingAddress` (the point's address) is not shown as a second block. A shop that wants both changes `components/order-details.tsx`.
- The page has no recipient name for a pickup point other than the order's contact, and no map.

## Known gaps (shipping step 8, not fixed)

Recorded on purpose (`docs/api/shipping.md`, Shipments; `docs/api/jobs.md`, job 8):
- A carrier that reuses a waybill number (unique per provider) makes the create's second transaction fail: the shipment stays `pending` (`409 conflict`) until `reconcile` after 2 minutes.
- An order can still be cancelled while its shipment is active; the shipment is not touched (cancel the waybill by hand). Fulfilment is manual and does not look at the shipment either. Review m-10: owner decision open (Open decisions).
- The provider calls of the shipment routes are not rate limited beyond the session (like other admin writes); the in-memory concurrency gate of the store lookups does not cover them.
- `findWaybill` takes an instant window (creation minus 5 minutes to the lookup plus 5 minutes, ISO 8601 UTC); a plugin maps it to the carrier's calendar (the new Nova Post API documents ISO 8601 UTC times but has no date or reference filter on `GET /shipments`, so the plugin pages the list: plan section 8.3, ADR 0030; unverified until plan step 7a). A "not found" settles `failed` only after 5 minutes (review M-2).
- The tracking job polls one page per provider sequentially; a slow carrier uses the job budget (30 s) for the run, the rest waits for the next tick.

## Known gaps (shipping step 6, not fixed)

Recorded on purpose (`docs/api/shipping.md`):
- The directory cache, the provider gate and the shipping rate limits are per process: several API instances multiply carrier calls (as the other in-memory limits).
- A cart quantity changed in another tab is answered `shipping_changed`, not `cart_changed` (no line notice tells it from a shipping change); the option carries the fresh total, so the shopper still consents to the right amount.
- A method change that commits while a checkout is between its method read and its commit does not stop that order (it is placed with the terms it read); the method row is read without a lock to keep the ADR 0015 lock order.
- The cache bounds were chosen for memory before Nova Post list sizes were measured (the spike rerun: Kyiv has about 8 000 points, about 390 KB per 100; the plugin returns at most 1 500 per city list, within the 5 000 a city the cache keeps). The estimate cache key uses a 50 000 minor-unit subtotal band, so an estimate may come from another subtotal within the band (informational only).
- `shipping_changed` for a method that is gone carries only `{methodCode, available: false, reason}`; the storefront (step 10) must reload the options.

## Known gaps (media upload, step 9 review, not fixed)

Recorded on purpose (plan `docs/plans/2026-10-23-media-upload.md`, "Step 9 review outcome"):
- `MEDIA_STORAGE_DRIVER=none` still answers `404` for every uploaded file (ADR 0028 decision 2); only the docs warn. Changing it (serve and mark under `none`) needs an ADR that supersedes decision 2.
- Attach marking recognises only the exact `MEDIA_PUBLIC_BASE_URL` prefix (L-3, documented): a hand-edited URL with another scheme or host spelling is foreign and its upload is deleted after 24 h. Not built: alias origins, or refusing such URLs.
- No per-user byte quota: one `catalog.write` user can store about 84 GiB a day within the rate limit (`docs/api/media.md`, Memory). No check in job 7 that skips uploads whose URL appears in `media.url` or `brand.logo_url`.
- The re-encoded output is one in-memory buffer (up to about 67 MB per processing slot) until the size check; measured peaks stay inside the 512 MB headroom.
- Nits: `If-None-Match: *` and a weak `W/"<key>"` answer `200` instead of `304`; empty shard directories stay after deletes. Surviving mutations accepted by the review: M28 (unreachable path check), M43 (equivalent chmod), M52 (unreachable over HTTP).
- The nginx `proxy_request_buffering off` advice (L-6) and the 120 s upload timeout (L-2) are reasoned, not tried against a real nginx or a throttled browser.

## Known gaps (cart, customers and orders review, not fixed)

Low findings of the step 8 review (`docs/plans/2026-10-18-cart-orders-review-fixes.md`), recorded on purpose; each needs its own owner-approved change:

- Header immutability: `sales_order` totals, currency, contact data and `placed_at` can be UPDATEd, nothing checks `subtotal_amount = sum(line_total)`, and a `DELETE FROM sales_order` cascades away the "append-only" journal and adjustments; no `TRUNCATE` trigger on `order_item`, `order_adjustment` and `order_status_change` (the same gap as the open `stock_movement` follow-up).
- Guest cancel takes `FOR UPDATE` on the order row before the token is checked (`orders.service.ts`); read and check without a lock, then lock.
- `mark-fulfilled` after a 365-day backorder: the sweep expires the extended reservation and `mark-fulfilled` then throws a plain `Error` (500) for ever; only cancel works.
- Cookie-less cart rows: each `POST /store/cart/items` without a cookie creates a cart row kept 30 days (120 per minute per address, unbounded with IPv6 /64 rotation).
- Account lockout abuse: 5 wrong passwords lock a customer for 15 minutes, repeatable without limit (the login limit is per address); same design as the admin side (ADR 0010), worse here because emails are discoverable through `register`. Guest checkout still works.
- Sibling-subdomain cart cookie: `session-token.ts` takes the FIRST `fluxkit_cart` cookie, so a cookie set with a more specific path from a related domain wins (needs a related-domain attacker).
- Event retry spacing is still anchored to `created_at` (ADR 0021, 0025): events that first fail long after creation use up all 10 attempts in 10 consecutive ticks. A `last_attempt_at` / `lease_until` column (a migration, needs approval) would fix it.
- A 10th dispatcher attempt that dies without recording a result is not logged as `abandoned` (ADR 0025); the operator query in `docs/api/jobs.md` finds it. A cart whose SUBTOTAL overflows with every line within the limit still answers `409` on read.
- The down migration of 0004 leaves `active` reservations of orders in place; they keep `reserved` up until the generic sweep runs.

Accepted by the owner in ADR 0024: per-IP open orders are not counted (one attacker can still use many emails, bounded by the checkout rate limit and the TTL); `too_many_open_orders` tells whoever presents an email that it holds the limit; a misconfigured `TRUST_PROXY` degrades the IP limits.

## Known gaps (storefront v1, not fixed)

Recorded on purpose; the same list is in the storefront plan's Outcome.

From the step 10 review (fixes merged in #79; these were recorded, not fixed):
- **L1, order replay with a changed cart** (owner decision 2026-10-18: no API or storefront change). The checkout fingerprint covers the cart id, not the lines, and the attempt hash covers the body only. A lost `201`, then refilling the cart with the same total and sending the same body, returns `200` with the OLD order. Small impact: the old order holds the same products.
- **L4, empty 404 and error shells without JavaScript.** Every 404 and error page is served as `<html id="__next_error__">` with an empty body, no `lang` and the generic title; the client renders the translated view. A Next 16 limitation.
- **Catalog reads are not rate limited** (a launch blocker above). Brand-filtered lists are not data-cached, so every view of one is an API call.
- **Focus after navigation is by path**: a query-only change (paging, a brand link) keeps the focus where it is.
- **CI e2e artifacts** (traces, videos, screenshots, uploaded when the job fails, kept 7 days) contain throwaway cookies, guest tokens and the e2e owner's session; they belong to an ephemeral, wiped database. Keep real secrets out of the e2e environment.
- The server-side time limit is 8 s per read, and the layout reads the config and the categories one after the other, so a hung API answers a catalog page with `500` after about 16 s.

From the step 8 findings (`apps/storefront/e2e/README.md`, "Findings of step 8"):
- `Referrer-Policy` belongs to the document: after the client-side navigation from checkout to the order page, the lookup request carries the checkout document's policy. A `<meta name="referrer">` on the order route would close it; not done.
- Before hydration the locale switcher's links have neither the query string nor the fragment; a click in that moment loses them.
- A failed sign-in clears the password field (the email stays); a second submit without retyping reports "Fill in this field".
- The 60 s data cache is kept on disk (`.next/cache/fetch-cache`): a storefront restarted within a minute of a re-seed shows the old variant ids.

Not verified in a browser (`apps/storefront/e2e/README.md`): screen readers, private browsing and blocked storage, the insecure-context refusal, the +/-, Update and remove buttons of a cart line, the account gate's redirect, sign-out, profile and password forms, order-history paging, other browsers and viewports, `next dev`, strict-mode double effects.

Storefront TODOs (`apps/storefront/README.md`, "Known limits and TODOs"): no link to the order history in the header; the cart is read once per page load; no "empty the cart" button; the checkout form is not kept across reloads (on purpose); the product page does not show the selected variant's attributes; no `global-error.tsx`.

## Working agreements (the owner's process)

- **Plan before each non-trivial task**; data model, checkout, auth go into `docs/plans/<date>-<slug>.md` and get approval first.
- **Decisions as a quiz**: one question, three options, the recommended one first. Do not ask about trivia.
- **Merge PRs only on the owner's explicit word.** Opening a PR is fine; merging is not. Stacked PRs: merge the base first, then retarget the next one to `main`.
- **Independent review**: the author never reviews their own change; a different agent (ideally a different model) reviews.
- **Verify agent work yourself**: clean clone, run each check separately and read its exit code (a chained command hides failures), run mutation checks on the rules that matter (remove the guard or filter and see tests fail).
- **Money logic is TDD**; show the failing-then-passing evidence. Never mask failures: no skipped tests, no `any` or `@ts-ignore`.
- **Red zones** need approval: new dependencies, migrations and schema, public contracts, payments, auth, pricing, moving core and feature code, destructive commands.
- **Roles**: Architect (ADRs, schema), Orchestrator (plans, task split, verification), Developer (scoped task in owned paths; parallel agents use disjoint paths and worktrees), Reviewer, Docs. Models: `docs/AGENT_WORKFLOW.md`.
- **Language**: the owner talks in Russian; code, docs, commits and rules are English. Commits are small and imperative; branches `feature/`, `fix/`, `chore/`.

## Run it locally

Normal path: `README.md` quick start (Docker Compose for Postgres, Redis, Meilisearch, then `createdb fluxkit_test`). The admin SPA: `apps/admin/README.md`.
Integration tests need real services and fail, not skip, without these variables (the database name must end in `_test`); run them in a subshell:

```bash
( export DATABASE_URL=postgres://<user>:<password>@127.0.0.1:5432/fluxkit_test \
         REDIS_URL=redis://127.0.0.1:6379 MEILI_URL=http://127.0.0.1:7700 MEILI_MASTER_KEY=<key>
  pnpm test )
```

- Browser tests: `pnpm test:e2e` (root; builds, then `apps/storefront/e2e`, then `apps/admin/e2e`; the first failing suite stops it). They need a separate `*_e2e_test` database in `E2E_DATABASE_URL` that each suite wipes, Chromium installed once, and the same Redis and Meilisearch variables. Step by step: `apps/storefront/e2e/README.md` and `apps/admin/e2e/README.md`. Not part of `pnpm test`.
- Manual check of the shop flow (cart, register, checkout, pay, fulfil, cancel, jobs): the curl sequence in `README.md`, Checkout walkthrough.
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
- The storefront renders personalized pages in the browser and calls `/store/*` on its own origin (ADR 0026); the Next.js server never handles store cookies.
- The admin SPA is static and calls `/admin/*` on the same origin; it holds no credential, sends `X-Fluxkit-CSRF` on every write and never retries a write (ADR 0027).
