# Handoff: current state and how we work

Read this first when you pick up the project (Claude Code, Codex, or a human). It says where we are, what is next, and the working agreements that are not obvious from the code.
Rules live in `AGENTS.md`; decisions in `docs/adr/`; plans in `docs/plans/`. This file is the short bridge between them.

**Update this file in every PR that changes project state** (a PR merged, a step finished, a decision taken, a new working agreement). Last updated: 2026-10-23 (media upload plan step 3 on `feature/media-core`: the pure media rules in `packages/core/src/media/` and the `MEDIA_*` variables in `loadEnv`, PR not opened; before that ADR 0028 "Media upload and storage" written on `chore/adr-0028-media`, media upload plan step 1; the plan was merged as #102). Before that, 2026-10-23 (media upload plan answered by the owner; admin UI step 13 merged as #101), and 2026-10-21 (admin UI step 13: the review fixes on `fix/admin-review`, PR not opened yet; admin UI steps 1 to 12 merged in #81 to #95).

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

Not built: payment and shipping providers, email delivery, search, image upload (the admin takes product and brand images as http(s) addresses only), and a production deployment (no API or storefront image; the admin is static files that the edge proxy serves, see `README.md`, Deployment notes).

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
| 2b | Media upload (storage, upload endpoint, its own plan and ADR first) | plan merged (#102, `docs/plans/2026-10-23-media-upload.md`); ADR 0028 merged (step 1); step 3 (core media rules and `MEDIA_*` configuration) written on `feature/media-core`, PR not opened; step 2 (the `sharp` dependency) waits for the owner's licence-policy edit; steps 4 to 9 not started |

The first CI run of `main` after #94 (commit `a4f1a52`, which includes the `e2e` job with both suites) was still in progress when this file was written. Its result is not recorded here; check it before relying on the e2e suites in CI.

## Next steps (in order)

1. Step 2b: media upload. Plan `docs/plans/2026-10-23-media-upload.md` (merged #102, owner's 12 answers, all recommended options); decisions in ADR 0028 (step 1, merged). Step 3 is done on `feature/media-core` (pure rules in `packages/core/src/media/`, `MEDIA_*` variables; PR not opened; it does not need `sharp`). Next: step 4 (API: migration 0005, `MediaModule`, CSRF exception; needs step 2 first because it uses `sharp`) after plan step 2, the dependency PR: `sharp` 0.35.5 exact in `apps/api`, `docs/dependencies.md`; it needs the owner's own licence-policy edit first (widen the LGPL exception for the `@img/sharp-libvips-*` binaries to the API in `scripts/license-policy.json` and AGENTS.md section 16; `check:licenses` matches by package name only, so it would pass without that edit and cannot be relied on, ADR 0028 decision 9). Then steps 3 to 9 (core rules and config, API with migration 0005 and the CSRF exception, cleanup job, api-client, admin UI, proxies and e2e, independent review).
2. Then, each with its own plan and owner approval: payment providers and the first Ukrainian providers (LiqPay, WayForPay, Monobank, Nova Poshta; orders are marked paid by hand until then), shipping providers, email delivery (password reset, email verification, order mails), search indexing (blocked by ADR 0005, see Open decisions), and a privacy plan before the EU launch (not written yet).
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
  - `ADMIN_E2E_PORT` and `ADMIN_E2E_API_PORT` are not in `.env.example` yet (AGENTS.md section 3 requires every variable there); the orchestrator adds them with the config change.
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
- Test fix left for the orchestrator: `apps/admin/src/areas/customers/customers-screen.spec.tsx` (lines 321 and 355) checks disabled buttons with `toContain("disabled")` on the class string, which every `Button` passes (`disabled:opacity-50`); the users spec checks the attribute.

Shell, i18n, images and e2e
- **CSP and images:** the admin CSP allows `'self' data:` and the configured `STOREFRONT_IMAGE_HOSTS`. The seed's images live on `example.com`, which the admin CSP refuses; the screens say so in text, and the e2e guard accepts exactly those refusals. Brand logos and product images from other hosts are not shown.
- **Example proxies:** the nginx example in `README.md` routes `/store/*` and `/admin/*` only with a slash after the prefix, so a bare `/admin` or `/store` reaches the storefront (the API accepts both); the Caddy matcher needs the same check. The e2e proxies match both forms; the examples need the fix before use. Since the step 13 fixes the nginx example sends the immutable `Cache-Control` on successful asset answers only and shows where to repeat a server-level HSTS header; the Caddy example may still mark a 404 of a missing asset immutable (reasoned, not tried). Neither example is tested.
- **A user change made in another tab is not noticed** (step 13 review L2, kept by the owner): `me` is read again only after a sign-in through the re-sign-in dialog or after a 403. If the cookie changes to another admin through another tab of the same browser, an open tab keeps the old user's header, navigation and permissions until a 401 or 403, while its requests run as the new user (no escalation: same browser profile). A fix would read `me` again on `visibilitychange` or focus.
- Problem reasons the problem map does not list (`invalid_code`, `invalid_characters`, `locale_not_allowed`, `not_an_object`, `not_a_string`, and the attribute combination reasons the form prevents) show the generic message with the code in small print.
- `react-router` 8.4.0 requires Node `>=22.22.0` (`engines`). The repository pins Node 22 (`.nvmrc`); CI and the sandbox use the latest 22.x.
- **e2e (step 11):** Chromium only; no automated accessibility scan (`@axe-core/playwright` is not approved). Not covered in a browser: the lost-answer paths of the writes (the Vitest specs and the step smoke runs cover them), the owner's role change and password reset screens, the category delete, the product list filters, the reservations list with real orders, `vite dev`. The suite has been run locally; its first CI run is in the list above. See `apps/admin/e2e/README.md`, "Not covered".

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
- **Storefront e2e flake seen once** (1 of 6 local runs of `pnpm test:e2e` during admin step 11): `token-hygiene` timed out after 60 s inside `request.allHeaders()`. Not investigated; CI retries once.
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
