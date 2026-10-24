# Handoff: current state and how we work

Read this first when you pick up the project (Claude Code, Codex, or a human). It says where we are, what is next, and the working agreements that are not obvious from the code.
Rules live in `AGENTS.md`; decisions in `docs/adr/`; plans in `docs/plans/`. This file is the short bridge between them.

**Update this file in every PR that changes project state** (a PR merged, a step finished, a decision taken, a new working agreement). Last updated: 2026-10-24 (shipping plan step 4: the shipping provider loader and registry `apps/api/src/shipping/registry/`, the test-only fake provider `packages/providers/_fake`, `SHIPPING_PROVIDERS_ENABLED` in `@fluxkit/config`, the dependency-cruiser rule `apps-must-not-import-providers` and the provider modes of `scripts/feature-matrix.sh` (`providers-on|off|deleted`, three more CI matrix jobs) on `feat/shipping-provider-loader`, PR not opened; ADR 0029 open question 2 answered: the fake lives in `packages/providers/_fake`; no route reads the registry yet. Before that, shipping plan step 3, merged as #120: migration `0006_shipping` with its down script, the Drizzle schema `apps/api/src/database/schema/shipping.ts` and `shipping-schema.spec.ts` on `feat/shipping-migration`, PR not opened; nothing reads or writes the five tables yet. Before that, shipping plan step 2: the core rules in `packages/core/src/shipping/` and the dependency-cruiser rule `core-must-not-import-providers` on `feat/shipping-core`, PR not opened; `OrderFulfilmentPort` deferred to step 8. Before that, shipping plan step 1: ADR 0029 "Shipping" written on `chore/adr-0029-shipping`, PR not opened; the shipping plan with the owner's quiz answers merged as #117. Before that, all PRs merged through #115: the media review fixes #112, the test-quality tails #113, the flaky slot-held upload test #114, the Dependabot patch bumps next 16.4.2, bullmq 6.3.16, vitest 5.0.5 and turbo 2.11.9 as #115, the audit fixes `body-parser` 2.4.0 #110 and the `multer` 2.5.0 override #111; only Dependabot #97 is open). Before that (test-quality tails #113: the `token-hygiene` e2e reads `allHeaders()` only of finished requests (a request still in flight or cancelled by a navigation never settles it; reproduced 8 of 60 under 6 workers, 0 of 60 after), and every admin spec now checks the `disabled` attribute instead of the class string; both gaps removed from "Known gaps". Before that, media upload plan step 9: the independent review found no High, two Medium and six Low; the fixes are on `fix/media-review`, PR not opened: the upload output is capped at `MEDIA_MAX_BYTES` with the new reason `output_too_large`, `MEDIA_PUBLIC_BASE_URL` is resolved under `MEDIA_STORAGE_DRIVER=none` too so attach marking keeps working, the docs say `none` breaks every uploaded URL, the upload control keeps the keyboard focus, the admin upload timeout is 120 s, the bare `/media` 404 has `no-store` and `nosniff`, a test kills the surviving mutation M21, the nginx example streams admin bodies; see the plan's "Step 9 review outcome". Step 8 merged as #109. Before that, media upload plan step 8 on `feature/media-proxies-e2e`: `/media` is routed by both e2e proxies and the Vite dev and preview proxy, both e2e suites run their API on a temp `MEDIA_DIR`, the admin suite has the browser scenarios of uploads (`apps/admin/e2e/tests/media-upload.e2e.ts`), the storefront suite has `media-route`, and the root `README.md` has the "Uploaded images" deployment notes; the next step is step 9, the independent review. Before that, 2026-10-23: step 7, merged as #108, the admin UI for uploads, the Media tab "Upload images" and the brand "Upload logo" with the one-at-a-time queue, see `apps/admin/README.md` "Image upload". Before that, step 5, merged as #107: the scheduler job 7 `delete-abandoned-uploads`, see `docs/api/jobs.md`. Before that, steps 4 and 6 (merged as #106): the api-client change of step 6, on top of step 4: `createAdminClient().uploadMedia` with an explicit binary body kind in the api-client, `AdminMediaUpload`, `AdminConfig.media`, the problem codes `storage_unavailable` and `uploads_disabled` and the reason `upload_not_found` in the admin and storefront message maps, which also turns the step 4 guard tests green; no upload UI yet. Before that, media upload plan step 4 on `feature/media-api`: migration 0005 `media_upload`, the media module with `POST /admin/media/uploads` and `GET /media/{key}`, the route-scoped octet-stream CSRF exception, the `mediaUpload` limit per admin user, the `media` block of `GET /admin/config` and attach marking in the media and brand saves, PR not opened; steps 1 to 3 merged as #103, #104 and #105). Before that, 2026-10-23 (media upload plan step 3 on `feature/media-core`: the pure media rules in `packages/core/src/media/` and the `MEDIA_*` variables in `loadEnv`, PR not opened; before that ADR 0028 "Media upload and storage" written on `chore/adr-0028-media`, media upload plan step 1; the plan was merged as #102). Before that, 2026-10-23 (media upload plan answered by the owner; admin UI step 13 merged as #101), and 2026-10-21 (admin UI step 13: the review fixes on `fix/admin-review`, PR not opened yet; admin UI steps 1 to 12 merged in #81 to #95).

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
| Admin UI v1 `2026-10-19-admin-ui.md` | Steps 1 to 12 merged (#81 to #95). Step 13 merged (#101): independent review (no High, one Medium, seven Low) and its fixes. Only step 2b (media upload) is left. |

Not built: payment and shipping providers (shipping is decided in ADR 0029; only its pure core rules, the migration `0006_shipping` and the provider loader with the test-only fake provider exist, nothing calls the rules, uses the tables or reads the registry), email delivery, search, and a production deployment (no API or storefront image; the admin is static files that the edge proxy serves, see `README.md`, Deployment notes). Image upload exists end to end (the API, the cleanup job, the api-client method, the admin controls, the proxies' `/media` routing, the browser e2e and the deployment notes: `docs/api/media.md`, `docs/api/jobs.md`, `apps/admin/README.md`, `README.md` "Uploaded images"); the independent review (step 9) is done and its fixes are on `fix/media-review` (PR not opened).

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
| 13 | Independent review by a different agent than the authors: done; fixes of M1, L1, L3 to L7 on `fix/admin-review` (plan, "Step 13 review outcome"); L2 kept as a known limitation | PR not opened |
| 2b | Media upload (storage, upload endpoint, its own plan and ADR first) | plan merged (#102, `docs/plans/2026-10-23-media-upload.md`); ADR 0028 (step 1, #103), `sharp` 0.35.5 (step 2, #104), the core rules and `MEDIA_*` configuration (step 3, #105), the API with the api-client method (steps 4 and 6, #106) and the cleanup job (step 5, #107) merged; step 7 (admin UI, #108) and step 8 (proxies, e2e, deployment notes, #109) merged; step 9 review done, fixes on `fix/media-review`, PR not opened |

The first CI run of `main` after #94 (commit `a4f1a52`, which includes the `e2e` job with both suites) was still in progress when this file was written. Its result is not recorded here; check it before relying on the e2e suites in CI.

## Next steps (in order)

1. The media upload plan is complete (plan `docs/plans/2026-10-23-media-upload.md`, ADR 0028; steps 1 to 8 merged as #103 to #109, the independent review and its fixes as #112). Open for the owner: the AGENTS.md section 16 edit for the libvips scope and the notices gap (Open decisions). Open Dependabot PR #97 (`@playwright/test` 1.56.1 to 1.64.1): its admin e2e run fails at the guard's "requests, CSRF and CSP" assertion with the newer Chromium (revision 1248, the sandbox has 1194); the guard needs adapting before the bump.
2. Then, each with its own plan and owner approval: payment providers and the first Ukrainian providers (LiqPay, WayForPay, Monobank, Nova Poshta; orders are marked paid by hand until then), shipping providers, email delivery (password reset, email verification, order mails), search indexing (blocked by ADR 0005, see Open decisions), and a privacy plan before the EU launch (not written yet).
   - Shipping: plan `docs/plans/2026-10-24-shipping.md` approved by the owner's quiz answers and merged (#117). Step 1, ADR 0029 "Shipping", merged as #118 (six open questions in its last section). Step 2 (core rules, TDD; no I/O) merged as #119; open question 1 answered: no `OrderFulfilmentPort` until step 8. Step 3 (migration `0006_shipping`, five tables, two triggers) merged as #120; ADR 0029 open question 5 answered there: the `store_pickup` text is the method's `description` map. Step 4 (provider loader and registry, the test-only fake provider, provider matrix in CI, `SHIPPING_PROVIDERS_ENABLED`) is on `feat/shipping-provider-loader`, PR not opened; open question 2 answered: `packages/providers/_fake`. Deviation from the plan text: the manifest follows ADR 0029 decision 8 (`"fluxkit": {"provider": "<code>", "kind": "shipping"}`, export `providerModule`), the constants already in core. Next: steps 5 and 6. Step 7a (Nova Poshta check with a real key) is blocked until the owner provides a test API key and the sender data; every Nova Poshta detail is unverified until then. Nothing is built.
3. Launch blockers still open: rate limiting for the catalog routes of `/store/*` (needs a dependency, red zone); decide whether Swagger UI and `/docs-json` stay public in production; the edge proxy in every deployed environment (`README.md`, Deployment notes; the examples are not tested in this repository, the e2e proxies `apps/storefront/e2e/proxy.ts` and `apps/admin/e2e/proxy.ts` are the tested routing references), `TRUST_PROXY` set to the exact hop count (ADR 0026); check the per-address limits from two networks after deployment.
4. Auth follow-ups (each needs its own plan): audit log, session token rotation, Redis-backed login throttle, two-factor, password reset by email.
5. Tooling: `pnpm db:migrate` (forward only; rollbacks are manual through `drizzle/NNNN_name.down.sql`), `pnpm seed`, `pnpm admin:create`, `pnpm admin:unlock` and `pnpm jobs:run-once` exist; there is no migration status or rollback command yet.
6. Smaller follow-ups from the reviews: the catalog items (C5, tests for the surviving mutations, the `variant.title` column that no route writes, the public attribute definition's display name in the serializer, `requiredText` in the store serializer); pricing (optional migrations `CHECK (reserved <= 1000000000)` on `inventory_level` and a statement-level `TRUNCATE` trigger on `stock_movement`, ADR 0012 and 0013; each needs its own approval).

## Open decisions (owner)

- **`AGENTS.md` (the owner's file) is behind the code.** The owner adds these lines:
  - Section 1, root scripts: `pnpm test:e2e` (builds, then the storefront suite and the admin suite `apps/admin/e2e`; not part of `pnpm test`) and `pnpm jobs:run-once`.
  - Section 1, configuration: `SCHEDULER_ENABLED`, `SCHEDULER_INTERVAL_SECONDS`, `ORDER_TOKEN_SECRET`, `MAX_OPEN_ORDERS`, `TRUST_PROXY`, `ADMIN_DEV_API_URL` (development only), and the suite-only variables `E2E_DATABASE_URL`, `E2E_PORT`, `E2E_API_PORT`, `E2E_STOREFRONT_PORT`, `ADMIN_E2E_PORT`, `ADMIN_E2E_API_PORT`.
  - Section 1, tooling: change "Playwright (e2e) is planned, not set up yet": it is set up for the storefront and the admin.
  - Section 16: `@playwright/test` 1.56.1 in `apps/storefront` and `apps/admin` (approved 2026-10-18 and 2026-10-19), and `react-router` 8.4.0 in `apps/admin` (approved 2026-10-19). See `docs/dependencies.md`. Also (media upload, owner answer 2, ADR 0028): the LGPL-3.0-or-later exception for the `@img/sharp-libvips-*` binaries widened to API image re-encoding, in AGENTS.md section 16 and the reasons in `scripts/license-policy.json`; needed before plan step 2.
  - Section 18: the CI job `e2e` runs both suites.
  - `ADMIN_E2E_PORT` and `ADMIN_E2E_API_PORT` are in `.env.example` since media plan step 8.
- **Third-party notices carry no licence texts** (media step 9 review L-5, owner and legal): `pnpm notices` lists name, version, licence and homepage only; the LGPL-3.0, GPL-3.0 and Apache-2.0 texts are not included (the libvips packages ship no LICENSE file), and the libvips bundle contains cairo (MPL-1.1) and aom (BSD-2-Clause plus the AOM patent licence), which the policy does not name. Details and the decision to take: `docs/dependencies.md`, "Notices gap found by the media step 9 review".
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
