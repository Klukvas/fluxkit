# Plan: pricing and inventory (v1)

Status: approved by the owner 2026-10-16 (decisions and assumptions below confirmed). Steps 1 to 5 merged (PRs #40 to #45: money module and ADR 0011, price and stock rules, migration `0003` and ADR 0012, admin prices and inventory API with the reservation service, store prices, availability and `GET /store/config`); step 6 (seeds and docs) implemented on branch `chore/pricing-step-6-seeds-docs` (PR pending); step 7 (independent review) not started. Red zones covered by the approval: money logic, schema and migration, public contracts, a change to the core publish rule.
Roles: Developers (Sonnet), steps run one after another (the owner asked for no parallel runs); independent Reviewer (Opus, a different model than the authors); Docs inside each step.
Follows: `docs/plans/2026-10-14-catalog.md` and `docs/plans/2026-10-16-auth-and-roles.md` (both completed). Design basis: ADR 0004 (price table, inventory levels, reservations, movement journal), ADR 0006 (catalog schema), ADR 0008 (variants of live products).

## Goal
Give every variant a price and a stock level, so the store can show prices and availability, and so the cart and checkout plan that follows can reserve and sell stock safely. After this plan an admin sets prices and stock through the API, the public store API returns prices and an availability status, a product cannot go live without prices, and the stock model already prevents overselling under concurrency.

### Out of scope (each gets its own plan)
Cart, checkout, orders and payments (they will call the reservation operations built here); tax calculation (only a display flag); discounts, coupons and the pricing pipeline; customer groups, tiered prices (minimum quantity) and validity dates; selling in several currencies; returns and refunds; price and availability facets or sorting in search; admin and storefront UI; CSV import and export; low-stock notifications; backorder dates.

## Existing functionality found
- Catalog schema has `variant` (SKU, flags) but no price or stock columns; `product_type.requires_shipping` exists. No money code exists in `packages/core`.
- `publishPreconditions` (`packages/core/src/catalog/lifecycle.ts`) decides what an active product needs; ADR 0008 adds the rules for live variants. The store API (`apps/api/src/catalog/store/`) lists only active variants and has no price or availability.
- Seeds create 26 demo variants through the admin services; the idempotent runner never updates existing rows.
- Roles and permissions live in `packages/core/src/auth`: `catalog.read`, `catalog.write`, `catalog.publish`, `users.manage`.
- `packages/config` parses env variables with loud errors; `.env.example` and `docs/contracts/config.md` document them.

## Decisions (owner, 2026-10-16)
1. **Price scope**: one price per (variant, currency) plus an optional "compare at" (old) price. Customer groups, tiered prices and validity dates arrive later as additive migrations.
2. **Stock**: per-variant flags `track_inventory` and `allow_backorder`; the public store API shows only an availability status (`in_stock`, `low_stock`, `out_of_stock`) and never exact quantities. Exact numbers are admin-only.
3. **Currency and publishing**: the shop sells in one currency set by `SHOP_CURRENCY` (default `UAH`). An active variant must have a price in that currency, so a product cannot be published without prices and the store never shows a variant without a price. Other currencies may be stored but are not sold and are never converted.

## Assumptions to confirm (my defaults; merging this plan approves them)
- **Tax**: prices are stored as entered; `PRICES_INCLUDE_TAX` (default `true`) is only a flag exposed to the storefront; no tax is calculated in this plan.
- **Rounding**: all money is integers in minor units, never floats. Percentages round half away from zero by default (an explicit rounding mode argument exists); one core module owns this, tested against an independent BigInt reference.
- **Limits**: an amount is an integer from 0 to 1 000 000 000 000 minor units (10 billion major units for a two-decimal currency), so it stays an exact JavaScript number and a Postgres `bigint`. `compare_at_amount`, when present, must be greater than `amount`.
- **Currencies**: a code table in core with ISO 4217 exponents (UAH, USD, EUR, PLN, GBP: 2; JPY: 0); `SHOP_CURRENCY` must be in it.
- **Permissions**: prices and stock use the existing `catalog.read` and `catalog.write`; no new permission now.
- **Locations**: one default location `main` is created by the migration; locations are read-only in the API for now (multi-warehouse needs no migration later, only endpoints).
- **Reservations**: this plan builds and tests the operations (reserve, release, commit, expire) as a domain service with concurrency tests, but exposes no HTTP route for them; the checkout plan will call them.
- **Low stock**: `LOW_STOCK_THRESHOLD` (default 5): `low_stock` when the available quantity is above 0 and at most the threshold.
- **Digital products**: generated variants of a product type with `requires_shipping = false` start with `track_inventory = false`.
- **Store settings**: a small public `GET /store/config` returns `{ currency, currencyExponent, pricesIncludeTax, defaultLocale, locales }` so the storefront formats money correctly.

## Design

### Core (pure TypeScript, `packages/core/src/pricing` and `inventory`, TDD)
- **Money**: `Money = { amount: integer, currency }`; currency table with exponents; `add`, `subtract`, `multiplyByQuantity`, `compare`, `percentageOf(amount, basisPoints, roundingMode)`; typed errors for currency mismatch, non-integer, negative where not allowed, overflow beyond the limit; exact `toDecimalString` and `parseDecimalString` without floats.
- **Price rules**: validate an amount, a currency and the compare-at rule; pick the sellable price of a variant (shop currency only).
- **Availability**: `availabilityOf(flags, levels, threshold)` = sum over locations of `on_hand - reserved` (never below 0); not tracked means `in_stock`; backorder allowed means `in_stock`; otherwise `out_of_stock`, `low_stock` or `in_stock`.
- **Stock operations as decisions**: reserve, release, commit and expire return the new level and the movement to record, or a typed refusal (insufficient stock, unknown quantity, already committed). Reserving never makes `reserved` exceed `on_hand` unless backorder is allowed.
- **Publish rule**: `publishPreconditions` gets the variants' prices and reports `price_missing` for every active variant without a price in the shop currency (the same check guards activating a variant of a live product). This changes a core function signature (internal, not a public contract).

### Data (migration `0003_pricing_inventory`, up and down)
- `price`: `id`, `variant_id` (FK, cascades with the variant), `currency` (three capital letters), `amount` bigint (0 to the limit), `compare_at_amount` bigint null (must exceed `amount`), timestamps; unique (`variant_id`, `currency`).
- `location`: `id`, `code` (unique, letter first), `name`, `is_default` (at most one default); the migration inserts `main`.
- `inventory_level`: (`variant_id`, `location_id`) primary key, `on_hand` >= 0, `reserved` >= 0, timestamps. "Reserved never exceeds on hand unless backorder" is enforced by the stock operation under a row lock, not by a CHECK (backorder must be allowed to oversell).
- `stock_movement`: append-only journal: `id`, `variant_id`, `location_id`, `delta` (not 0), `kind` (`receipt`, `adjustment`, `sale`, `return`), `on_hand_after`, `reason` text null, `reference` text null, `actor_id` (admin user, set null on delete), `created_at`. A database trigger rejects UPDATE and DELETE.
- `reservation`: `id`, `variant_id`, `location_id`, `quantity` > 0, `status` (`active`, `committed`, `released`, `expired`), `expires_at`, `reference` text null, timestamps; index on (`status`, `expires_at`).
- `variant` gains `track_inventory` (default true) and `allow_backorder` (default false). Existing demo variants become "tracked, no stock" and, without prices, invisible in the store until priced; this is pre-release data (see Risks).
- Concurrency: every stock write takes `SELECT ... FOR UPDATE` on the `inventory_level` row inside one transaction and records its movement in the same transaction.

### Admin API (all under `/admin`, existing roles)
- Prices: `GET /admin/products/:id/variants/:variantId/prices`, `PUT .../prices/:currency` (`{amount, compareAtAmount?}`), `DELETE .../prices/:currency` (refused when it would leave an active variant of an active product without a shop-currency price), and a bulk `PUT /admin/products/:id/prices` for many variants in one transaction.
- Inventory: `GET .../variants/:variantId/inventory` (levels per location, available, flags), `POST .../inventory/adjustments` (`{locationId?, delta | setOnHand, kind, reason}`; refuses a result below 0 or below `reserved`), `GET .../inventory/movements` (paginated), `GET /admin/locations`.
- `PATCH` of a variant accepts `trackInventory` and `allowBackorder`.
- Publishing and activating a variant apply the new price rule with `validation_failed` entries `price_missing` per variant.

### Store API (public)
- Variants in `GET /store/products/:slug` get `price { amount, currency, compareAtAmount | null }` and `availability`; the product gets an overall `availability`; list items get `price { from, to }` and `availability`. A variant without a shop-currency price is never returned. Quantities, locations and movements never appear (leak tests).
- `GET /store/config` as listed above.

### Config
`SHOP_CURRENCY`, `PRICES_INCLUDE_TAX`, `LOW_STOCK_THRESHOLD` in `packages/config`, `.env.example`, `docs/contracts/config.md`; malformed values fail loudly.

### Seeds
Demo variants get prices and stock; the runner stays additive: it prices and stocks only the products it creates in that run, and never touches a product that already exists (so it does not fill a missing price or level on an existing demo product; digital demo products are untracked). Documented in `seeds/README.md`.

## Steps (one branch and PR each, in order, merge only on the owner's word)

Done: 1 to 7 (step 4 was split into 4a and 4b). Step 7, the review, is recorded in `docs/plans/2026-10-16-pricing-review-findings.md`; its findings are fixed in the branch `fix/pricing-review-findings` (the plan is closed when that PR is merged).
1. **ADR 0010-style decision record and core money module**, tests first, with the BigInt reference tests for rounding and the overflow bounds. (Developer, Sonnet.) The ADR number is the next free one at that time.
2. **Core pricing and inventory rules**: price rules, availability, reserve/release/commit/expire decisions, and the publish-rule change, tests first, including the property-style tests that stock never goes negative. (Developer, Sonnet.)
3. **Schema and migration `0003`**: tables, trigger, flags, default location, constraint tests, up/down/up/down. (Developer, Sonnet.)
4. **Admin API**: config, prices, inventory, flags, locations, the reservation domain service, the publish-rule integration, concurrency tests against real Postgres (many parallel reservations never oversell), append-only journal tests. (Developer, Sonnet.)
5. **Store API**: price, availability, `GET /store/config`, leak tests, query-count test stays constant. (Developer, Sonnet.)
6. **Seeds and docs**: demo prices and stock, `docs/api/pricing.md` (one line per endpoint), `docs/api/catalog.md` and `docs/contracts/api.md` updates, `docs/files/*`, README, HANDOFF, CHANGELOG. (Developer, Sonnet.)
7. **Independent review** by Opus (a different model than the authors): rounding and overflow, oversell races, journal integrity, availability leaks, publish-rule regressions, migration reversibility, tests that cannot fail. Findings are fixed before the plan is closed.

## Data and API changes
Migration `0003_pricing_inventory` (five new tables, two new columns on `variant`, one inserted location, one trigger). New admin endpoints and new fields in the store API (`docs/contracts/api.md`), `GET /store/config`, three config variables, a changed core `publishPreconditions` input.

## Risks
- Money bugs are expensive. Mitigations: one core module, integers only, tests first including an independent BigInt reference and overflow cases, mutation checks by the orchestrator, independent review.
- Overselling under concurrency: row lock plus transaction per stock write, tested with real parallel requests and a lock-wait test (like the product row lock tests).
- Existing demo databases lose their store visibility until variants are priced (the store hides priceless variants). Pre-release data only; the bulk price endpoint and reseeding on a fresh database cover it. This is noted in the migration docs and HANDOFF.
- The publish rule change affects ADR 0008 flows (generated variants of live products): tests cover that an inactive priceless variant does not block publishing while an active one does.
- JSON numbers above 2^53 lose precision: the amount limit keeps every value exact.
- Rounding policy for percentages is fixed now, but the pricing pipeline (discounts, taxes) is a later plan and may need more modes; the mode argument is there for that.

## Verification
- Per step, from a clean clone: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm check:boundaries`, `pnpm check:licenses`, `pnpm test` (own scratch database), `pnpm audit:prod`, `pnpm --filter @fluxkit/api db:drift`, `pnpm check:docs`.
- Step 1 and 2: failing-then-passing evidence for every rule; rounding compared with a BigInt reference over many random cases.
- Step 3: up, down, up, down; constraint tests; the trigger rejects UPDATE and DELETE on `stock_movement`.
- Step 4: concurrency tests (parallel reservations of the last unit: exactly one succeeds; parallel adjustments keep `on_hand` equal to the sum of movements); the publish rule over HTTP.
- Step 5: leak tests (no quantities, no locations, no priceless variants); the query count stays constant.
- Orchestrator mutation checks: drop the row lock, allow negative stock, use floats in a multiplication, skip the compare-at rule, expose a quantity in the store, drop the publish price rule, allow UPDATE on the journal.

## Docs to update
`docs/adr` (new record and index), `docs/api/pricing.md` (new), `docs/api/catalog.md`, `docs/contracts/api.md`, `docs/contracts/config.md`, `docs/files/api.md`, `docs/files/core.md`, `README.md`, `.env.example`, `seeds/README.md`, `CHANGELOG.md`, `docs/HANDOFF.md`.

## Needs approval (red zones touched by this plan)
- Money and pricing logic (the whole plan).
- Migration `0003_pricing_inventory`.
- Public contract changes: store API fields, `GET /store/config`, new admin endpoints, three config variables.
- The change to core `publishPreconditions`.
- No new dependency is requested.

## Outcome (steps 1 to 7)

Built:
- Core (`packages/core`): the money module (integers in minor units, ISO 4217 table, exact arithmetic, percentages in basis points with explicit rounding), price rules, availability, reserve/release/commit/expire/adjust decisions, and the `price_missing` publish rule.
- Schema: migration `0003_pricing_inventory` (`price`, `location` with `main`, `inventory_level`, append-only `stock_movement`, `reservation`, variant flags `track_inventory` and `allow_backorder`), ADR 0011 and 0012.
- Admin API: prices (single and bulk), variant stock flags, locations, inventory read, adjustments and movements, and the `ReservationsService` (no HTTP route) with concurrency tests on real Postgres.
- Store API: variant, product and list `price` and `availability` without quantities, `GET /store/config`; variants without a shop-currency price are hidden.
- Config: `SHOP_CURRENCY`, `PRICES_INCLUDE_TAX`, `LOW_STOCK_THRESHOLD`.
- Seeds: demo prices on all 26 variants (three with a compare-at price) and demo stock showing in stock, low stock, out of stock and backorder; digital products untracked. The runner writes prices before publishing and stock through the inventory service with a system (`null`) actor; a second run adds no row.

Deviation: the inventory service had to accept a `null` actor (the column already allowed it) because seeding has no admin user.

Known follow-ups (each needs its own plan or a fix after the review):
- Variants generated or created manually for a live product start active and priceless; the store hides them until they are priced, and a live product with such a variant cannot be republished after an unpublish until it is priced.
- `ReservationsService.expireDue` needs a scheduler (a BullMQ job); nothing calls it yet.
- One reservation holds one location; the checkout plan has to split an order across locations.
- Adjustments of different variants of one product serialize on the product row lock.
- `apps/api/src/catalog/store/store.spec.ts` is very large and could be split by topic.
- Step 7, the independent review by a different model (Opus), is done: `docs/plans/2026-10-16-pricing-review-findings.md` (R1 to R11, all fixed or documented in `fix/pricing-review-findings`; ADR 0013). Still open after it: rebuilding the variants of a draft product on an option change can delete the history of a variant that was sold and unpublished (ADR 0013); optional later migrations (`CHECK (reserved <= 1000000000)`, a `TRUNCATE` trigger on `stock_movement`); `expireDue` needs a scheduler that loops on `nextCursor`.
