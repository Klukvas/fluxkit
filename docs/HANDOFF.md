# Handoff: current state and how we work

Read this first when you pick up the project (Claude Code, Codex, or a human). It says where we are, what is next, and the working agreements that are not obvious from the code.
Rules live in `AGENTS.md`; decisions in `docs/adr/`; plans in `docs/plans/`. This file is the short bridge between them.

**Update this file in every PR that changes project state** (a PR merged, a step finished, a decision taken, a new working agreement). Last updated: 2026-10-20 (admin UI step 6a, the first half of the product screens (list, create, the editor with General, Attributes, Categories and the lifecycle) and lazy area messages in `apps/admin`, is on branch `feature/admin-products-a`, PR pending; before that, admin UI step 5, the catalog dictionary screens (attributes, options, product types, brands, category tree) in `apps/admin`, is on branch `feature/admin-catalog-dictionaries`, PR pending; before that, on 2026-10-19: admin UI step 4b, the admin SPA shell under `/admin-ui/` with `react-router` 8.4.0, is on branch `feature/admin-ui-shell`, PR pending; steps 3 and 4a merged in #83 and #84; admin UI step 4a, the admin components in `packages/ui` and the contrast scan of `apps/admin/src`, is on branch `feature/admin-ui-components`, PR pending; admin UI step 3, the typed admin client, is on branch `feature/admin-api-client`, PR pending; step 2, the additive admin API, merged in #82; admin UI plan merged (#80), ADR 0027 accepted on branch `chore/adr-0027-admin-ui`; before that branch `fix/storefront-review`: fixes for the storefront step 10 review; PR pending. Step 9, the docs sweep, is on `chore/storefront-step-9-docs`). Storefront steps 1 to 8 are merged (PRs #66 to #77); the details of each step are in the plan's Outcome, `docs/plans/2026-10-18-storefront.md`.

## Where we are

Fluxkit is a white-label e-commerce template (own TypeScript core, NestJS + Drizzle/Postgres, Meilisearch, Redis/BullMQ, Next.js storefront, React/Vite admin). See `README.md` and `AGENTS.md`.

| Area | State |
|---|---|
| Monorepo scaffold, CI, licenses, docs | Complete (plan `2026-10-14-monorepo-scaffold.md`; PRs #1 to #5, docs PR #10). |
| Catalog `2026-10-14-catalog.md` | Complete: steps 1 to 7 merged (step 7 in PR #25); step 8 independent review done 2026-10-16, fixes in PRs #27 to #29. Open items: `2026-10-16-catalog-review-findings.md` (C5, information items, surviving mutations). |
| Auth and roles `2026-10-16-auth-and-roles.md` | Complete: plan PR #31; steps 1 to 4 merged (PRs #32 to #36); step 5 review fixes PR #37 (`pnpm admin:unlock`, ADR 0010). |
| Pricing and inventory `2026-10-16-pricing-and-inventory.md` | Complete: steps 1 to 6 merged (PRs #40 to #46); review fixes PR #47; option changes keep stock history PR #48 (ADRs 0011 to 0014). |
| Cart, customers and orders `2026-10-17-cart-and-orders.md` | Complete: plan PR #49; steps 1 to 8 merged (PRs #50 to #60); cancelling a paid order releases unsold reservations PR #59 (ADR 0022); step 8 review closed in PR #64; review fixes PR #61 (guest token on replay, ADR 0023), PR #62 (`MAX_OPEN_ORDERS`, `TRUST_PROXY`, ADR 0024), PR #63 (outbox leases and bounded jobs, ADR 0025). Plan Outcome and `2026-10-18-cart-orders-review-fixes.md`. |
| Storefront v1 `2026-10-18-storefront.md` | Steps 1 to 8 merged: plan PR #65; ADR 0026 (#66); cart `requiresShipping` and OpenAPI `403` (#67); typed client and `loadStorefrontEnv` (#68); tokens and UI components (#69, danger colour #70); shell (#72); catalog (#73); cart and accounts (#74); checkout and orders (#76); Playwright e2e (#77). Step 9 (docs sweep) on branch `chore/storefront-step-9-docs`, PR pending; step 10 (independent review) done 2026-10-19, its fixes are on `fix/storefront-review`, PR pending (plan: "Step 10 review outcome"). No online payment and no search in v1: orders stay `awaiting_payment` until an admin marks them paid or they expire. |
| Admin UI v1 `2026-10-19-admin-ui.md` | Plan merged (#80); step 1 (ADR 0027) merged (#81); step 2 (additive admin API, nine items, no migration) merged (#82); step 3 (`createAdminClient` in `@fluxkit/api-client`: 85 functions, `ADMIN_OPERATIONS` with permissions, hand-written types, contract test; no API change, no dependency) merged in #83. Step 4a (ten dumb admin components in `packages/ui`: `DataTable`, `Dialog`, `ConfirmDialog`, `Tabs`, `DescriptionList`, `FilterBar`, `SideNav`, `LocaleTextField`, `StatusBadge`, `LiveRegion`; contrast scan extended to `apps/admin/src`; no token, dependency or API change) merged in #84. Step 4b (the shell in `apps/admin`: sign-in, re-sign-in dialog, permission table from `ADMIN_OPERATIONS`, route table with lazy area chunks, uk/en messages per area, problem-code map, security headers in `apps/admin/security-headers.ts`, build checks; new runtime dependency `react-router` 8.4.0, dev-only variable `ADMIN_DEV_API_URL`) built on `feature/admin-ui-shell`, PR pending. Step 5 (catalog dictionaries: attributes with flags, typed validation and options; options with values; product types with assignments; brands with a logo URL; the category tree with lazy levels, create, edit, move and delete; `diffForPatch` and `runWrite` in `src/lib` for the later steps; no API, schema, dependency or variable change) built on `feature/admin-catalog-dictionaries`, PR pending. Step 6 was split into 6a and 6b. Step 6a (lazy area messages: initial JavaScript 439 481 / 129 557 bytes raw / gzip down to 398 093 / 121 328, and 398 881 / 121 484 with the products area, budget 440 000 / 135 000 unchanged; `/products` list with status, brand, category and slug-or-SKU search in the URL, debounced; `/products/new`; `/products/:id` with the summary, lifecycle (publish, unpublish, archive, restore, delete of a never-published product), WAI-ARIA tabs from `src/layout/product-editor.ts` with the tab in `?tab=`, General (PATCH of changed fields), Attributes (generated from the product type's product-level definitions, whole-map PATCH, checks compared with core), Categories (lazy tree picker, primary), publish refusals mapped onto tabs and fields, `variants.N` by row and SKU; Media, Options, Variants (6b) and Prices, Stock (7) are translated placeholders; no API, schema, dependency or variable change) built on `feature/admin-products-a`, PR pending. Steps 2b (media upload plan), 6b (Media, Options, Variants tabs) and 7 to 13 (prices and stock, orders, customers, users, e2e, review) not started. |

## Next steps (in order)

1. **Storefront step 10 fixes**: the review is done (Opus 5.5, 1 high, 3 medium, 9 low); the fixes are on branch `fix/storefront-review` (PR pending, see the plan's "Step 10 review outcome"). After the merge the storefront plan closes; the owner decides the storefront known gaps below.
2. **Next plans**, each with its own plan file and owner approval: payment providers and the first Ukrainian providers (LiqPay, WayForPay, Monobank, Nova Poshta; orders are marked paid by hand until then), shipping providers, email delivery (password reset, email verification, order mails), search indexing (blocked by ADR 0005, see Open decisions), the admin UI (plan merged, PR #80: `docs/plans/2026-10-19-admin-ui.md`; step 1, ADR 0027, is on branch `chore/adr-0027-admin-ui`; step 2, the additive admin API (`GET /admin/config`, product `q`, product-type attribute definitions, product-level prices and inventory, reservations list, orders `customerId`, OpenAPI `x-fluxkit-permission`, CSRF header and `parentId`), merged in #82, no migration; step 3, the typed admin client, merged in #83; step 4a merged in #84; step 4b, the shell, is on `feature/admin-ui-shell`, PR pending; step 5, the catalog dictionaries, is on `feature/admin-catalog-dictionaries`, PR pending; step 6a, the first half of the products, is on `feature/admin-products-a`, PR pending; next: the step 2b media upload plan, step 6b (the Media, Options and Variants tabs: the editor's tab configuration, the placeholders and the publish-problem mapping of `variants.N`, `options`, `media` are ready for them) and step 7 (Prices and Stock tabs)), and a privacy plan before the EU launch (not written yet).
3. **Launch blockers still open**: rate limiting for the catalog routes of `/store/*` (needs a dependency, red zone); decide whether Swagger UI and `/docs-json` stay public in production; in every deployed environment an edge proxy routes `/store/*` to the API and sets `X-Forwarded-For`, with `TRUST_PROXY` set to the exact hop count (ADR 0026; example configurations in `README.md`, not tested in this repository); check the per-address limits from two networks after deployment.
4. **Auth follow-ups** (each needs its own plan): audit log, session token rotation, Redis-backed login throttle, two-factor, password reset by email.
5. **Tooling**: `pnpm db:migrate` (forward only; rollbacks are manual through `drizzle/NNNN_name.down.sql`), `pnpm seed`, `pnpm admin:create`, `pnpm admin:unlock` and `pnpm jobs:run-once` exist; no migration status or rollback command yet.
6. **Smaller follow-ups from the reviews**: the catalog items (C5, tests for the surviving mutations, the `variant.title` column that no route writes, the public attribute definition's display name in the serializer, `requiredText` in the store serializer); pricing (optional migrations `CHECK (reserved <= 1000000000)` on `inventory_level` and a statement-level `TRUNCATE` trigger on `stock_movement`, ADR 0012 and 0013; each needs its own approval).

## Open decisions (owner)

- **Typed store client generator**: `openapi-typescript` (MIT) is not used: its peer range `typescript ^5.x` excludes the pinned TypeScript 6.0.3. `@fluxkit/api-client` has hand-written types and a contract test against `docs/api/openapi.json`. Revisit when the generator supports TypeScript 6 (a separate change; the TypeScript pin stays the owner's decision).
- **`AGENTS.md` (the owner's file) is behind the code**: it does not mention `pnpm test:e2e` (section 1 root scripts; section 1 tooling still says Playwright is "planned, not set up yet"), `pnpm jobs:run-once`, the variables `SCHEDULER_ENABLED` and `SCHEDULER_INTERVAL_SECONDS`, or the CI job `e2e` (section 18). Section 16 does not list `@playwright/test` (approved by the owner on 2026-10-18, see `docs/dependencies.md`). The owner adds these lines.
- **`@axe-core/playwright`** (MPL-2.0, dev tooling) for automated accessibility checks in the e2e suite: not approved, not added.
- **Storefront decisions taken where the plan was silent** (step 7; the owner may revisit): no billing address and no recipient fields at checkout; without `sessionStorage` the checkout attempt lives in memory with a visible warning instead of refusing.
- **Index for the admin product search** (step 2): the slug arm of `GET /admin/products?q=` is a scan of `product` because `product_slug_key` cannot serve `LIKE 'prefix%'` on a non-`C` collation; an index `ON product (slug text_pattern_ops)` (a migration with a down script, red zone) would make it an index range scan. Not needed for a catalog of a few thousand products; the owner decides.
- Ukrainian search morphology and variant-level facet counts (ADR 0005). They block the search plan, not the catalog.
- Branch protection on `main` (GitHub settings, owner side). Pinning GitHub Actions by commit SHA.
- Permanent negative test for the dependency-cruiser `core-must-not-import-infrastructure` rule.
- ADR 0006 (accepted) and the code differ on two points: the default page size (code: admin 50, store 24; ADR section 9: 24) and category filters (`?categoryId` on admin products matches direct assignments only; ADR section 8 says listings include descendants). Fix the code, or supersede the ADR; do not edit it.
- Owner sign-off still wanted on the core rule inside ADR 0008: required variant-level attributes are asked only of active variants at publish.
- **`"sideEffects": false` for `@fluxkit/core`** (admin UI step 4b finding): the admin does not import core because one import pulls zod and the whole core (88.6 KB minified); with the flag it would be 1.5 KB. An internal change of `packages/core` the orchestrator may approve (plan, "Forms and validation"); until then the admin copies constants and compares them in tests.

## Known gaps (admin UI, steps 5 and 6a, not fixed)

- **Category roots are found by paging the flat list.** `GET /admin/categories` cannot list the root level alone (`parentId` takes only a uuid, no `parentId=null`; without it every category of every level is listed). The tree screen pages the list (100 rows a request, at most 10 requests = 1 000 categories) and keeps the rows without a parent; a catalog with more than 1 000 categories would show a "list truncated" notice and may miss roots. An additive `parentId=null` filter on `GET /admin/categories` (a public contract change, red zone) would remove the workaround (`apps/admin/src/areas/catalog-dictionaries/category-tree.ts`, `collectRoots`).
- **Product list search and category filter are what the API offers**: `q` is a slug prefix or an exact SKU (no title search until the search plan), the category filter matches direct assignments only (ADR 0006 discrepancy, open decision above), and brand names are read per distinct brand of the page (at most six at a time; the list has no brand name).
- **Products editor (6a)**: the attribute PATCH sends the whole product-level map (the API has no partial update), so two admins editing different attributes of one product overwrite each other's attribute changes (last write wins for the map; the General fields are per field). Variant-level attributes, media, options, variants, prices and stock are not editable yet (6b, 7); their tabs list the publish problems that belong to them.
- **Tree expansion is lost** when the admin opens an editor and comes back (the tree reloads with its roots collapsed); keeping the open nodes in the URL would fix it.
- **Brand logos from other hosts are not shown** by the admin's CSP (`img-src 'self' data:` plus the configured hosts in the proxy); the screen says so in text. Uploads are the media plan (step 2b).
- **Reasons the problem map does not list** (`invalid_code`, `invalid_characters`, `locale_not_allowed`, `not_an_object`, `not_a_string`, and the attribute combination reasons that the form prevents) show the generic message with the code in small print.

## Known gaps (storefront v1, not fixed)

Recorded on purpose; the same list is in the plan's Outcome.

From the step 10 review (fixes on `fix/storefront-review`; these were recorded, not fixed):
- **L1, order replay with a changed cart** (owner decision 2026-10-18: no API or storefront change). The API's checkout fingerprint covers the cart id, not the lines, and the storefront's attempt hash covers the body only. A lost `201`, then refilling the cart with the same total and sending the same body, returns `200` with the OLD order; the new lines are not ordered. Small impact: the old order holds the same products.
- **L4, empty 404 and error shells without JavaScript.** Every 404 and error page is served as `<html id="__next_error__">` with an empty body, no `lang` and the generic title; the client renders the translated view. A Next 16 limitation (the 4b finding), not fixed.
- **Catalog reads are not rate limited** (already a launch blocker below). Since the review fix, brand-filtered lists are not data-cached, so every view of one is an API call; the cache of the other lists is bounded.
- **Focus after navigation is by path**: a query-only change (paging, a brand link) keeps the focus where it is.
- **CI e2e artifacts** (traces, videos, screenshots, uploaded when the job fails, kept 7 days) contain throwaway cookies, guest tokens and the e2e owner's session; they belong to an ephemeral, wiped database. Keep real secrets out of the e2e environment.
- The server-side time limit is 8 s per read and the layout reads the config and the categories one after the other, so a hung API answers a catalog page with `500` after about 16 s.
 None of them is a severity ranking: the e2e README gives no severity for the first four.

- Findings of storefront step 8 (`apps/storefront/e2e/README.md`, "Findings of step 8"):
  - `Referrer-Policy` belongs to the document: after the client-side navigation from checkout to the order page, the lookup request carries the checkout document's policy (the `Referer` is the order URL without its fragment, so no token). A `<meta name="referrer">` on the order route would close it; not done.
  - Before hydration the locale switcher's links have neither the query string nor the fragment; a click in that moment loses them.
  - A failed sign-in clears the password field (the email stays); a second submit without retyping reports "Fill in this field".
  - The 60 s data cache is kept on disk (`.next/cache/fetch-cache`): a storefront restarted within a minute of a re-seed shows the old variant ids.
- Not verified in a browser (`apps/storefront/e2e/README.md`): screen readers, private browsing and blocked storage, the insecure-context refusal, the +/-, Update and remove buttons of a cart line, the account gate's redirect, sign-out, profile and password forms, order-history paging, other browsers and viewports, `next dev`, strict-mode double effects.
- Storefront TODOs (`apps/storefront/README.md`, "Known limits and TODOs"): no link to the order history in the header (step 7); the cart is read once per page load, so a cart changed in another tab shows at the next write or navigation; no "empty the cart" button; the checkout form is not kept across reloads (on purpose); the product page does not show the selected variant's attributes; no `global-error.tsx`.
- Not built: payment, shipping, email, search, most of the admin UI (the shell, the catalog dictionaries and the first half of the product screens exist), a storefront image and a production deployment.

## Known gaps (cart, customers and orders review, not fixed)

Low findings of the step 8 review (`docs/plans/2026-10-18-cart-orders-review-fixes.md`), recorded here on purpose; each needs its own owner-approved change:

- Header immutability: `sales_order` totals, currency, contact data and `placed_at` can be UPDATEd, nothing checks `subtotal_amount = sum(line_total)`, and a `DELETE FROM sales_order` cascades away the "append-only" journal and adjustments; no `TRUNCATE` trigger on `order_item`, `order_adjustment` and `order_status_change` (the same gap as the open `stock_movement` follow-up).
- Guest cancel takes `FOR UPDATE` on the order row before the token is checked (`orders.service.ts`), so anyone who knows an order number can make that row wait behind their request (20 per 10 minutes per address); read and check without a lock, then lock.
- `mark-fulfilled` after a 365-day backorder: the sweep expires the extended reservation and `mark-fulfilled` then throws a plain `Error` (500) for ever; only cancel works.
- Cookie-less cart rows: each `POST /store/cart/items` without a cookie creates a cart row kept 30 days (120 per minute per address, unbounded with IPv6 /64 rotation).
- Account lockout abuse: 5 wrong passwords lock a customer for 15 minutes, repeatable without limit (the login limit is per address); same design as the admin side (ADR 0010), worse here because emails are discoverable through `register`. Guest checkout still works.
- Sibling-subdomain cart cookie: `session-token.ts` takes the FIRST `fluxkit_cart` cookie, so a cookie set with a more specific path from a related domain wins (needs a related-domain attacker).
- Event retry spacing is still anchored to `created_at` (ADR 0021, 0025): events that first fail long after creation use up all 10 attempts in 10 consecutive ticks. A `last_attempt_at` / `lease_until` column (a migration, needs approval) would fix it and give the dispatcher a real visibility timeout.
- A 10th dispatcher attempt that dies without recording a result is not logged as `abandoned` (ADR 0025); the operator query in `docs/api/jobs.md` finds it. A cart whose SUBTOTAL overflows with every line within the limit still answers `409` on read.
- The down migration of 0004 leaves `active` reservations of orders in place; they keep `reserved` up until the generic sweep runs.

Accepted by the owner in ADR 0024: per-IP open orders are not counted (one attacker can still use many emails, bounded by the checkout rate limit and the TTL); `too_many_open_orders` tells whoever presents an email that it holds the limit; a misconfigured `TRUST_PROXY` degrades the IP limits (too high lets a client choose its address, too low keeps one shop-wide window).

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

- Manual end-to-end check of the shop flow (cart, register, checkout, pay, fulfil, cancel, jobs): the curl sequence in `README.md`, Checkout walkthrough (needs a migrated and seeded database whose name ends in `_dev`, `_test`, `_demo` or `_local`, an owner, and `ADMIN_COOKIE_SECURE=false` and `STORE_COOKIE_SECURE=false` for plain HTTP).
- Only one process may use the test database at a time (migration tests drop the schema; `apps/api` runs spec files one by one on purpose).
- Browser tests of the storefront: `pnpm test:e2e` (root; builds, then `apps/storefront/e2e`). It needs a separate `*_e2e_test` database that it wipes, Chromium installed once, and the same Redis and Meilisearch variables; step by step in `apps/storefront/e2e/README.md`. Not part of `pnpm test`.
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
