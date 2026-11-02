# API: matched variant of a search hit, stock hints on cart lines (2026-11-02)

Status: proposed, then built on branch `feature/api-matched-variant-and-stock-hints` (see "Results"). Owner approval: ADDITIVE public API fields (public contract change, SemVer minor, nothing breaking). No PR is opened by the implementing agent.
Source: the two API gaps recorded by the storefront UX review, batch A (`docs/plans/2026-11-02-storefront-ux-review-a.md` on `fix/storefront-ux-review-a`, PR 213, "Needs an API field"): (1) matched variants of a search hit, (2) stock against the cart's quantity.

## Goal

1. `GET /store/search` says, per item, which sellable variants match the variant-level part of the selection (options, variant-level attributes, `inStock`, `price`), with their price range, best availability and one representative variant to link to.
2. Cart lines say whether the line's quantity can be reserved now (`insufficientStock`) and, only when stock is low, how many can (`maxQuantity`), computed on the server from real stock with the checkout's own rule.

## Existing functionality (checked)

- The engine holds one document per sellable variant, built by core `buildSearchDocuments` (ADR 0034 decision 2) from Postgres facts read by `readSearchProducts` (`apps/api/src/search/indexer/search-catalog.reader.ts`). Filters are built only by core `buildSearchFilter`. Items are hydrated from Postgres by product id (`StoreService.listItemsByIds`), never from the engine.
- The engine's `displayedAttributes` are `id`, `productId`, `productSlug`, `title`: the price and stock bit of the representative hit are NOT retrievable without an index settings change (and a rebuild); and with `distinct` the engine returns ONE document per product, not all matching ones.
- The SQL listing `GET /store/products` (the storefront's fallback, ADR 0039) applies category, one brand and the page only: no variant-level filter exists there.
- Cart lines already carry `availability` (`in_stock`, `low_stock`, `out_of_stock`, core `availabilityOf` over every location) and an `out_of_stock` notice. The checkout reserves at the DEFAULT location with core `decideReserve` (`ReservationsService`), and refuses with `409 checkout_refused` / `insufficient_stock` without a number.
- `LOW_STOCK_THRESHOLD` (default 5) exists (`PricingConfig.lowStockThreshold`).
- There is no order quote route; the only checkout answer that carries a cart is `409 cart_changed` (its `cart` is the `GET /store/cart` shape, so it gains the fields with no extra code).

## 1. Matched variant of a search item

### Field shape (additive, `GET /store/search` items only)

```
items[].match?: {
  variantId: uuid,                 // the representative matching variant (link target)
  variantCount: integer >= 1,      // how many sellable variants of the product match
  price: {from, to, currency},     // lowest and highest price of the matching variants, shop currency, minor units
  availability: "in_stock" | "low_stock" | "out_of_stock",  // best availability among the matching variants
  optionValues: [{optionCode, valueCode}]  // of the representative variant, sorted by option code
} | null
```

- **Present** exactly when the request selects something at variant level: `inStock`, `price`, any `opt.<code>`, or an `attr.<code>` whose facet `level` is `variant` (core `hasVariantLevelSelection`). **Absent** otherwise (text only, browsing, `brand`, `category`, product-level attributes): then every sellable variant matches and the item's own `price` and `availability` already describe them. Absent rather than `null`, so unfiltered pages and the SQL listing keep byte-identical items.
- **`null`** when the request is variant-level but no sellable variant of the product matches in Postgres any more (the index is behind: a price, stock or option change not synced yet). The product is then marked for sync (`stale_hit`, as for a dropped product; since the PR 214 review (M1) a `stale_hit` mark only adds a missing queue row and leaves a queued one as it is, so repeated filtered reads never reset a failing product's backoff nor bump the `change_seq` of a sync in flight) and stays on the page (its product-level data is still current).
- **Representative** (`variantId`, `optionValues`): best availability first (`in_stock`, `low_stock`, `out_of_stock`), then the lowest price, then the product's variant order (position, id). Deterministic and independent of the engine's choice of its distinct hit and of the sort.
- `optionValues` uses the same `{optionCode, valueCode}` pairs as `GET /store/products/{slug}` `variants[].optionValues`; codes are stable identifiers (`docs/contracts/api.md`), so the storefront builds `?opt.<code>=<value>` from them in either locale.
- Shape names follow the product detail (`optionValues`, `price {from, to, currency}`, `availability`). No `sku`, no stock number, no attribute values.

### How it is computed (same documents, Postgres truth)

- After hydration, for the page's products only (at most 48), and only when the selection is variant-level: `readSearchProducts` (the indexer's reader, 6 batched queries for any page size, no N+1), then core `buildSearchFilterDocuments` (the filter fields of the documents, the SAME code path `buildSearchDocuments` writes into the engine: extracted, not copied), then core `matchesSearchSelection(document, selection)` per variant document. Text words are not part of the match: `match` reflects the facet and price selection only (the engine's typo and stem matching cannot be reproduced in SQL; the hit is still found by the words).
- Why Postgres and not the engine hit: (a) the engine can return only one document per product with `distinct` and cannot return `price`/`inStock` without a settings change and a rebuild; (b) ADR 0034 decision 10: prices and availability on a store answer come from Postgres, never from the index, so a stale index never shows a stale price. The filter fields are built by the same core function as the index documents, so both sides read the same fields.
- `availability` per variant is core `availabilityOf` over every location (as the item's `availability`); `price` is the shop-currency price; only sellable variants (core `isVariantSellable`) have documents, so a variant with no shop-currency price never matches.

### Security analysis (search)

- Public data only: the variant id and option codes are already public (product detail, cart add); price and availability are what the product page shows. `is_internal` and hidden attributes never reach a filter document (`isPublicAttribute` in the shared builder) and are never echoed; no SKU, no quantity.
- The selection is the already validated `SearchSelection` (core `parseSelectionParams`); the matcher evaluates typed values, no client text is interpreted.
- No new engine call, no new rate-limit window; the extra reads are bounded by the page size (48) and run only for variant-level selections.

### Response size, cache, parity

- At most 48 items x about 200 bytes. Absent on unfiltered lists.
- `Cache-Control: public, max-age=30` is keyed by the URL, which contains `f` and `price`: correct. The storefront's shared list cache (ADR 0040) keeps only UNFILTERED lists (no `f`, no `price`), which never carry `match`; filtered reads are `no-store`. Nothing to change.
- SQL fallback (ADR 0039): `GET /store/products` has no variant-level filter, so it never has `match`, and the search answer of the same list (category, brand, no variant selection) has none either: identical items. When the storefront falls back with a variant selection in the address it already says the filters were not applied (ADR 0039 decision 4), so there is nothing to match. `GET /store/products` is unchanged.
- Engine parity: a spec asks the engine (no `distinct`, the real filter of `buildSearchFilter`) for the matching variant documents of many selections and compares the set with `matchesSearchSelection` over Postgres on the same data.

### Index and document impact

None: no new index field, no settings change, `SEARCH_DOCUMENT_VERSION` unchanged, no rebuild. The refactor of `buildSearchDocuments` keeps its output (existing document specs).

## 2. Stock hints on cart lines

### Field shape (additive, every cart line in every cart response and `cart_changed`)

```
lines[].insufficientStock: boolean
lines[].maxQuantity: integer >= 0 | null
```

- `insufficientStock`: `true` exactly when the checkout, run now, would refuse this line with `insufficient_stock`: core `decideReserve` on the default location's level (no level row = nothing on hand) with the variant's flags and the line's quantity (core `cartLineStockHint`, which calls `decideReserve`, so the two can not drift). `false` for untracked variants, backorder variants and lines whose variant is not sellable (`unavailable`: the checkout answers `cart_changed` for them first); also for a line taken out for `line_total_out_of_range`, which the checkout refuses for its total, not for stock (PR 214 review m4).
- `maxQuantity`: the units that can be reserved now (`max(0, on_hand - reserved)` at the default location) ONLY when `insufficientStock` is `true` and that number is at most `LOW_STOCK_THRESHOLD`; `null` otherwise. So a shopper with 999 of a variant that has 22 learns "not that many" and a shopper with 8 of 3 learns "at most 3".
- Nothing is reserved; nothing is stored on the line; the hint is recomputed on every response. The checkout stays the judge (stock can change between the read and the order).

### Security and business decision

- **Chosen:** a boolean for every tracked line plus a number only when it is low (at most `LOW_STOCK_THRESHOLD`). A low number is already roughly public (`low_stock` means 1 to the threshold), so the exact low count adds little; above the threshold no count is given.
- **Honest limit:** the boolean can still be used to find the exact count with repeated quantity changes (a binary search over 1..999 takes about 10 writes, inside the `cartWrite` window of 120 a minute). Before this plan only `POST /store/checkout` answered that (its refusal reserves nothing), but `checkout` allows 10 attempts per 10 minutes per address and needs a full body, so about one variant per 10 minutes; with the hint every cart write answers it, so about 12 variants a minute per address (PR 214 review m3). The decision is about not broadcasting stock in every answer, not about making it secret; a shop that needs secrecy needs per-variant purchase limits (not built).
- **Alternatives:** (a) always return `maxQuantity` when insufficient: best UX ("only 22 left") but gives every scraper the exact count of every variant in one write each; rejected. (b) boolean only: safe, but the shopper has to guess repeatedly; rejected for low stock where the guess is the common case. (c) the number only after the shopper exceeds stock: this is (a).
- Location: the default location, because that is where the checkout reserves (ADR 0015, `docs/api/orders.md`). In a shop with several locations `availability` (all locations) can say `in_stock` while `insufficientStock` is `true`: the hint then tells the truth the checkout would tell. `maxQuantity` then discloses the default location's exact reservable count (at most `LOW_STOCK_THRESHOLD`), a per-location number `availability` never showed (PR 214 review M2). Decision: kept, also with several locations. It is exactly what the shopper can order now (the checkout reserves only there); hiding it there would leave an `in_stock` line refused with no guidance; the boolean already tells that the default location is short, and the number stays bounded by the threshold and only for a line that is short. Documented in `docs/api/cart.md` and `docs/contracts/api.md`.

### Snapshot and reservation rules

Unchanged: a cart reserves nothing, prices are recomputed per read, the order snapshot is taken at checkout. The hint reads `inventory_level` without a lock in the same statement count as today (the existing level query gains a join to `location` for `is_default`).

## Backward compatibility

- Additive only: new optional `match` on search items (absent without a variant selection), two new always-present cart line fields. No field removed, renamed or retyped; no status or error code changed. Old clients ignore unknown fields (the storefront's parsers in PR 213 read named fields only; the api-client types gain the fields).
- `docs/contracts/search.md` and `docs/contracts/api.md`: new rows "since unreleased"; SemVer minor.

## Migration need

None. No table, column, index or setting changes; no `SEARCH_DOCUMENT_VERSION` bump. If one turns out to be needed the work stops and is reported.

## TDD list (failing first)

Core (`packages/core`):
- `search/match.spec.ts`: `matchesSearchSelection` (options OR within, AND across; multiselect arrays; boolean and number attributes; categories array; brand; `inStock` true and false; price range open ends; a missing field never matches; the empty selection matches); `hasVariantLevelSelection` (product-level only: false; option, inStock, price, variant attribute: true); `buildSearchFilterDocuments` equals the filter fields of `buildSearchDocuments` for the same facts and skips unsellable variants and internal attributes.
- `inventory/stock-hint.spec.ts`: `cartLineStockHint`: enough stock; exactly enough; one too many; stock 0; no level row; reserved stock lowers it; reserved above on hand; backorder; untracked; threshold 0; count above the threshold gives `null`; invalid input throws as `decideReserve`.

API integration (real Postgres, Redis, Meilisearch):
- `apps/api/src/search/store/store-search-match.spec.ts`: colour x size product (red-S 599 in stock, red-L 629 out of stock, blue-L 599 in stock): `opt.color:red & opt.size:l` gives `match` = red-L 629 `out_of_stock`; `opt.color:red` gives 2 variants 599..629 `in_stock`, representative red-S; several matching documents with the cheaper one out of stock; `inStock:false`; `inStock:true` with a backorder and an untracked (digital) variant; `price` range; a filter that matches nothing (empty page, no item); no variant selection (no `match` key); both locales give the same `match`; a variant priced only in another currency never matches; index behind (`match: null`, product queued `stale_hit`); exact key set (no SKU, no quantity); engine parity (variant ids of the engine without distinct = the matcher's) for a list of selections; SQL fallback parity (`/store/products?category=` and `?brand=` vs `/store/search?f=category:` and `f=brand:` give equal items and no `match`).
- `apps/api/src/cart/cart-stock-hints.spec.ts`: 999 of 22 (`insufficientStock`, `maxQuantity: null`); 8 of 3 (`maxQuantity: 3`); exactly 22 of 22 (false); stock 0 (`true`, `0`); reserved stock by another order lowers it; backorder and untracked lines (false/null); unavailable line (false/null); a change of stock between two reads (the second read follows; the checkout refuses with `insufficient_stock` when the first read said `false`); the hint agrees with the checkout on the same carts; the `cart_changed` cart carries the fields; no stock number appears above the threshold.
- `packages/api-client`: types and `contract.spec.ts` shapes follow the OpenAPI document.

## Consumption notes for the later storefront task (after PR 213 and this branch merge)

- Search card (`product-card.tsx`, `search-results.tsx`, catalog views): when `item.match` is an object, show `match.price` (one price when `from === to`, else "from") and `match.availability` instead of the product's; link to `/p/<slug>?opt.<optionCode>=<valueCode>` for each pair of `match.optionValues` (the product page already reads them, PR 213 item 2c); `match.variantCount > 1` may say "N options match". When `item.match` is `null`, show the product-level data with the existing neutral note (the index is catching up). When `match` is absent, keep today's card. Remove the "Price and stock depend on the option" heuristics of PR 213 item 2 for the cases `match` covers.
- Fallback (SQL listing): no `match`; the existing "filters not applied" notice stays.
- Cart and checkout pages: a line with `insufficientStock: true` shows "Not enough in stock" next to the quantity; with `maxQuantity` a number, "Only N left" and the stepper capped at `maxQuantity` (0: "Out of stock, remove the line"); with `maxQuantity: null`, "Lower the quantity; the shop does not show how many are left". The checkout lists such lines above the form (PR 213 item 3c). The server still refuses at checkout; keep the existing `insufficient_stock` message.
- The product page (add to cart) gets no stock number: an add answers the cart, whose line then carries the hint.

## Files

- Core: `packages/core/src/search/document.ts` (extract the filter fields), new `packages/core/src/search/match.ts` (+ spec), `packages/core/src/search/index.ts`; new `packages/core/src/inventory/stock-hint.ts` (+ spec), `packages/core/src/inventory/index.ts`.
- API: `apps/api/src/search/store/store-search.service.ts`, `store-search.schemas.ts`, new spec `store-search-match.spec.ts`; `apps/api/src/cart/cart-pricing.service.ts`, `cart.schemas.ts`, `apps/api/src/catalog/store/store.repository.ts` (`is_default` of the level's location), new spec `apps/api/src/cart/cart-stock-hints.spec.ts`.
- Client: `packages/api-client/src/types.ts`, `contract.spec.ts`.
- Docs: `docs/api/search.md`, `docs/api/cart.md`, `docs/api/orders.md` (one line), `docs/contracts/search.md`, `docs/contracts/api.md`, `docs/api/openapi.json` (`pnpm openapi:export`), `docs/files/api.md`, `docs/files/core.md`, `CHANGELOG.md`, `docs/HANDOFF.md` (one line), this plan (results).
- Not touched: `apps/storefront` (PR 213 owns it), migrations, index settings.

## Risks

- Extra reads on variant-filtered searches (6 batched queries for at most 48 products). Measured on the test data only; at 20 000 products the per-page cost does not grow with the catalog.
- The matcher mirrors the engine's filter semantics in TypeScript; the engine parity spec pins it (an engine upgrade that changes filter semantics fails it).
- The stock boolean can be probed (above); documented.

## Verification

Each separately with its exit code: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm check:boundaries`, `pnpm check:docs`, `pnpm check:env`, the full API test suite and the core and api-client tests against this agent's own Postgres, Redis and Meilisearch (not the shared stack), `pnpm openapi:export` with the freshness spec, and the feature-matrix modes `search-on` and `search-off` if the sandbox allows.

## Results (2026-11-02)

Status: built on the branch as planned; no PR opened by the implementing agent. No migration, schema, index setting, document version, configuration variable or dependency change.

- **Shapes as planned:** `items[].match?: {variantId, variantCount, price {from, to, currency}, availability, optionValues [{optionCode, valueCode}]} | null` on `GET /store/search`; `lines[].insufficientStock: boolean`, `lines[].maxQuantity: integer | null` on every cart response and the `cart` of `409 cart_changed`.
- **Code:** core `buildSearchFilterDocuments` (the per-variant code of `buildSearchDocuments` extracted into `sellableVariantFields`, so the index and the matcher share it; the existing document specs are unchanged and pass), core `matchesSearchSelection` and `hasVariantLevelSelection` (`search/match.ts`), core `cartLineStockHint` (`inventory/stock-hint.ts`, built on `decideReserve`); API `search-match.ts` (`matchOfProduct`), `StoreSearchService.withMatches`, `CartPricingService.stockHint`, `listStockLevelsForVariants` with `isDefaultLocation`.
- **Deviation:** `apps/storefront/src/lib/test-fixtures.ts` (`cartLine()`, a test fixture) got the two new required `CartLine` fields as defaults (`false`, `null`), because `pnpm typecheck` failed on it otherwise; no storefront component, page or message was changed, and PR 213 does not touch that file. The alternative (optional fields in the client types) would contradict the OpenAPI document and the contract test.
- **Existing spec updated:** the allowed-key list of the cart leak test (`cart-pricing.spec.ts`) gained `insufficientStock` and `maxQuantity`; its stock values (424 243 on hand, 31 337 reserved) are still checked to be absent.

**Failing-first evidence** (logs `mv-red-*.log` in the agent's scratchpad):
- Core: `match.spec.ts` and `stock-hint.spec.ts` before the code: 16 failed of 16 (`buildSearchFilterDocuments is not a function`, `cartLineStockHint is not a function`); after: 2075 passed in 106 files.
- API: `cart-stock-hints.spec.ts` 10 failed of 10 (`insufficientStock: undefined`); `store-search-match.spec.ts` 10 failed, 3 passed (the guards: no `match` without a variant selection, no item for a selection nothing fits, SQL listing parity); after: 23 of 23 passed.
- Mutations (each run red, then restored): the hint read a non-default location's level: 7 of 10 cart hint tests failed; the matcher ignored `inStock: false`: the availability test and the engine parity test failed.

**Verification** (each separately, exit code 0 unless noted): `pnpm lint` 0; `pnpm format:check` 0; `pnpm typecheck` 0 (22 tasks); `pnpm check:boundaries` 0 (2006 modules, 0 violations); `pnpm check:env` 0; `pnpm check:docs` (see the report); API suite against this agent's own Postgres 16, Redis and Meilisearch: 254 files, 4414 passed, 1 failed (the cart leak test's allowed-key list, expected, then updated and re-run: 29 of 29 passed); core 2075 passed; `@fluxkit/api-client` 1346 passed (contract test against the regenerated `openapi.json`); `pnpm openapi:export` (the freshness spec passed in the suite); `pnpm feature-matrix search-off` 0 and `search-on` 0 (on a fresh database; a first `search-on` run on the database `search-off` had already seeded failed with "expected the seed's catalog writes to mark products", because the idempotent seed wrote nothing; CI gives each mode a fresh database).

**Not verified:** the storefront and admin e2e suites (no UI code changed); response time of variant-filtered searches at 20 000 products (6 extra batched reads per page, only measured on test data); the multi-location case beyond one extra location.

## Review fixes (2026-11-02)

Independent review of PR 214: no blocker, one major (M1) and minors. Fixed on the branch after merging `origin/main` (`3298978`, PRs 212 and 213):

- **M1:** `SearchQueue` writes a `stale_hit` mark as `on conflict (product_id) do nothing`: a store read adds a row only when the product has none and never resets a queued product's backoff or bumps the `change_seq` of a sync in flight (a queued row already guarantees a sync of the current data; job 13's claim and settle rules are unchanged). Failing first: `search-queue.spec.ts` "a stale_hit mark adds a missing row but leaves a queued one untouched" (1 failed, then 7 of 7 passed).
- **M2:** `maxQuantity` with several locations is the default location's count; kept and documented (Location bullet above, `docs/api/cart.md`, `docs/contracts/api.md`).
- **m3:** the probing rate is stated as it is (about one variant per 10 minutes through the checkout before, about 12 a minute through cart writes now).
- **m4:** a line taken out for `line_total_out_of_range` carries no hint. Failing first: `cart-stock-hints.spec.ts` (received `true`/`3`), then 11 of 11 passed.
- **m5:** the engine-parity spec covers a product-level multiselect, a variant-level boolean and number range, a category with a descendant and combinations; plus an HTTP check of `match` for a variant-level number range and boolean. No mismatch found (14 of 14 passed).
- **m6:** `docs/HANDOFF.md` refreshed.

Verification after the fixes (each separately): `pnpm lint` 0, `format:check` 0, `typecheck` 0, `check:boundaries` 0, `check:docs` 0, `check:env` 0, `openapi:export` + prettier: no diff, core tests 0 (2075), api-client tests 0 (1346), full API suite 0 (254 files, 4418 tests, private Postgres 16, Redis, Meilisearch), `feature-matrix search-off` 0 and `search-on` 0 (fresh private databases).
