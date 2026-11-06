# Coffee-shop supplies demo seed (2026-11-06)

Branch `feature/coffee-shop-seed` from `origin/main` `06c61f3`. Role: Developer. Owner decision of 2026-11-06: `pnpm seed` (and `pnpm demo:up`)
creates a COFFEE-SHOP SUPPLIES catalog (a cafe or coffee-to-go business buys cups, lids, straws, milk, ice, coffee, syrups, machines). The current
demo catalog (T-shirt, hammer, e-book, ...) stays, unchanged in effect, as a TEST FIXTURE dataset loaded by a new `pnpm seed:test`, and every test
consumer switches to it. No new dependency, environment variable, DB schema, API shape, payment or auth change.

## Goal

- `pnpm seed` = coffee dataset (default), `pnpm seed:test` = the fixture dataset (today's data, files moved, values unchanged).
- Coffee dataset: at least 70 products (aim 75 to 90) with correct domain data, product types, options and attributes; prices in minor units;
  stock states; brands; a category tree; filterable attributes; synonym groups; three home banners; the same three shipping methods.
- Drawn product pictures for every coffee product: parametric SVG archetypes rasterised with the existing `sharp`, a studio look.

## Found (existing functionality)

- Data: `seeds/src/` (`types.ts` shapes; `dictionaries.ts` attributes and options; `presets.ts` product types; `taxonomy.ts` brands and categories;
  `products.ts` 8 products, 26 variants; `shipping.ts` 3 methods, all created INACTIVE; `synonyms.ts` 14 groups; `banners.ts` 3 banners with fixed
  ids; `index.ts` exports `catalogSeed`); data spec `seeds/src/catalog-seed.spec.ts`. Images `seeds/assets/*.webp` drawn by
  `scripts/generate-demo-images.mjs` (committed WebP, because librsvg output and fonts differ between machines; `--check`, `--only`).
- Runner: `apps/api/src/seed/seed.ts` (entry) -> `seed-command.ts` (`runSeedCommand(argv, env, {seed?, assetsDir?})`, production guard,
  `formatSummary`) -> `catalog-seeder.ts` (`CatalogSeeder.run(seed)`, everything through the admin services; images through
  `MediaUploadService.storeSystemImage`; `DEFAULT_SEED_ASSETS_DIR` = `seeds/assets`). SKUs are proposed by core `proposeSku` from the slug and the
  option value codes unless set (`PATCH /admin/products/{id}/variants/{variantId}` accepts `sku`).
- Shipping methods: today all three are seeded INACTIVE (the reviewer's demo stack had the courier activated by hand). The coffee dataset reuses the
  same three definitions unchanged (moved to a shared module), so "as today" holds; the runner is not changed to activate one.
- Trust bar copy: storefront config (`apps/storefront/src/config/trust-bar.ts`), not seed data: untouched. The storefront home reads categories,
  products and banners from the API and names no demo slug (`config/home.ts`), so it works with either dataset.

### Consumers of the seed (git grep `pnpm seed`, `seed.js`, `runSeedCommand`, `catalogSeed`, `@fluxkit/seeds`, demo product names)

| Consumer | Needs | Change |
|---|---|---|
| `package.json` `seed` | coffee | unchanged command (default dataset is coffee); new `seed:test` |
| `apps/api/package.json` `seed` | coffee | unchanged; new `seed:test` (`--dataset test`) |
| `scripts/demo-up.mjs` (`pnpm --filter @fluxkit/api seed`) | coffee | unchanged command, comment and final message mention the coffee catalog |
| `scripts/demo-pay.mjs` | no product data | unchanged |
| `apps/storefront/e2e/prepare-database.ts` (`run("seed/seed.js")`) | fixture | `--dataset test` |
| `apps/admin/e2e/prepare-database.ts` (`run("seed/seed.js")`) | fixture | `--dataset test` |
| storefront e2e specs (`Demo T-shirt`, `demo-hammer`, ...: 26 files) and admin e2e specs (orders, payments, privacy, roles, shipping) | fixture | none (they read what prepare-database seeds) |
| `scripts/feature-matrix.sh` `search-off` and `search-on` (`node apps/api/dist/seed/seed.js`, "Demo Screwdriver", wrench/spanner) | fixture | `--dataset test` in both modes |
| `apps/api/src/seed/seed.spec.ts` (`runSeedCommand([], env)`, `catalogSeed`) | fixture | `--dataset test`, `testCatalogSeed`; same assertions |
| `apps/api/src/search/store/newest-order.spec.ts` | fixture | `--dataset test`, `testCatalogSeed` |
| `apps/api/src/test/seed-rows.ts` (`removeSeedRows`) | fixture | takes the dataset (default fixture), any category depth |
| `apps/api/src/spikes/search-morphology.spec.ts` (`demoSynonymGroups`) | fixture | import of the fixture groups |
| `apps/storefront/src/lib/test-fixtures.ts`, `theme-mode.spec.ts` | own literals, no seed | none |
| CI `.github/workflows/ci.yml` | runs `pnpm test`, `pnpm test:e2e`, `pnpm feature-matrix` (no direct `pnpm seed`) | none (covered through the rows above) |
| Docs: `README.md` (quick start, "Try it locally", scripts table), `seeds/README.md`, `AGENTS.md` root scripts, `docs/files/seeds.md`, `docs/files/api.md`, `apps/*/e2e/README.md`, `docs/HANDOFF.md`, `CHANGELOG.md` | | updated (AGENTS.md: only `pnpm seed:test` added to the scripts list) |

## Design

### Dataset selection

- `seed.js --dataset coffee|test` (default `coffee`); an unknown value or a missing value after the flag fails before anything is touched
  (exit 1). The production guard runs first, as today. `runSeedCommand(argv, env, {seed?})`: `seed` (tests) still wins over the flag.
- The summary's first line names the dataset (`Seed finished (dataset coffee).`).
- Root `pnpm seed:test` = `pnpm build && pnpm --filter @fluxkit/api seed:test`.

### Package layout (`seeds/src`)

- `types.ts` (shared shapes; `SeedVariantCommerce.sku?` added: an explicit, systematic SKU the runner sets through the variant admin service;
  absent in the fixture, so the fixture keeps its generated SKUs), `shared/shipping.ts` (the three methods, moved), `test-fixture/*` (today's
  `banners`, `dictionaries`, `presets`, `products`, `synonyms`, `taxonomy`, moved with `git mv`, values unchanged), `coffee/*` (the new data),
  `index.ts` exports `testCatalogSeed`, `coffeeCatalogSeed`, `seedDatasets` (`{coffee, test}`) and the fixture's named parts. `catalogSeed` is
  removed so every consumer chooses consciously (TypeScript finds every place).
- Specs: `test-fixture/catalog-seed.spec.ts` (today's spec, moved, same assertions), `coffee/coffee-seed.spec.ts` (new), `datasets.spec.ts` (no
  code, slug or banner id shared by the two datasets except the shipping methods, so both can live in one database).

### Coffee dataset

- Options (generate variants): `volume` (110 ml to 1 l), `pack_size` (1 to 1000 pcs), `net_weight` (100 g to 5 kg), `grind` (beans, espresso,
  filter, turkish), `diameter` (straws, lids, tampers), `cup_slots` (2, 4), `glove_size` (s to xl), `card_value` (gift card amounts). Codes differ
  from the fixture's (`color`, `size`), so both datasets can be seeded into one database.
- Attributes (describe): `ware_material`, `cup_wall`, `ware_color` (select, filterable), `milk_base` (select, filterable), `fat_content`
  (number, %, 1 decimal), `roast_level`, `coffee_origin`, `processing` (select, filterable), `arabica_share` (number, %), `syrup_flavour`
  (select, filterable), `machine_kind` (select, filterable), `group_count`, `power_w`, `voltage_v`, `capacity_ml` (number, filterable/sortable),
  `burr_type` (select), `storage_notes` (localized text), `digital_format` (select), `supplier_code` (internal: must never leave the public API).
- Product types: `disposable_ware` (options volume, pack size, diameter, cup slots), `coffee` (net weight, grind), `dairy` (volume, pack size),
  `ice` (net weight), `tea_cocoa` (net weight, pack size), `syrup_sauce` (volume), `equipment` (no options, except tampers and pitchers:
  diameter, volume), `cleaning` (pack size, volume), `consumables` (pack size, glove size), `digital_goods` (`requiresShipping` false, card value).
- Categories: a tree of about 11 roots with children, one three-level branch (coffee > beans > espresso blends / single origin).
- About 10 fictional brands (invented names, no real trademark), about 80 products. Product names describe generic items ("cone paper filters,
  size 02"), never a real brand or model.
- Prices in UAH minor units, realistic for Ukrainian HoReCa suppliers in 2026; a few compare-at prices; stock: most in stock, a few low
  (1 to 5), a few out of stock, one backorder; the digital products untracked.
- SKUs: `<GROUP>-<ITEM>-<OPTION...>` in upper case (for example `CUP-DW-KR-350-25`), set explicitly per variant.
- Synonym groups: only words that exist in the coffee titles (`стаканчик`/`стакан`, `трубочка`/`соломинка`, `кавомашина`/`кофемашина`,
  `лід`/`лёд`, ...), and English ones (`straw`/`straws` is handled by the stemmer, so only real alternatives such as `stirrer`/`stir stick`).
- Banners: three, fixed ids distinct from the fixture's, coffee pictures and copy (no `TODO(fluxkit)` text in shopper-visible copy, neutral).
- Shipping: the three shared methods, inactive as today.

### Images

- Choice: committed WebP files in `seeds/assets/coffee/`, drawn by a deterministic generator `scripts/generate-coffee-images.mjs` (with
  `--check` and `--only`), the same approach as `scripts/generate-demo-images.mjs`. Reasons: the labels on the pictures need text ("350 мл", a
  fictional brand), and text rendering depends on the fonts installed on the machine (the Docker images and Windows have different or no fonts),
  so rendering at seed time would give different or broken pictures per machine and would make the seed depend on `sharp` text rendering; the
  existing demo images are committed for the same reason. Budget: each file under about 40 KB, total under about 2.5 MB, 1200 x 1200.
- Renderer: one function per archetype (paper cup with lid and sleeve, PET cold cup with ice and straw, lids, cup carrier, straw bundle, stirrers,
  sugar sticks, carton, cream bottle, ice bag, coffee bag with valve and window, capsule box, syrup bottle with pump, squeeze bottle, tea box,
  espresso machine, grinder, kettle, scale, tamper, pitcher, portafilter, knock box, thermometer, ice maker, blender, filters, cleaning products,
  napkins, bags, receipt rolls, gloves, gift card, guide), parameterised by colours, label and count; a shared studio scene (gradient background,
  contact shadow, highlights). A contact sheet is rendered and inspected; weak archetypes are redrawn.
- Uploads stay the real media service (WebP re-encoded by it).

### Runner changes (small)

- `--dataset` parsing in `seed-command.ts`; `sku` on a variant set through `VariantsService.update` (the same call that sets `allowBackorder`).
- Nothing else: the same admin services, idempotency, production guard and `MEDIA_STORAGE_DRIVER=none` path.

## Test impact

- Unit (no services): `seeds` specs (fixture spec unchanged in substance; coffee spec: >= 70 products, category/price/variant per product,
  images exist in `seeds/assets/coffee`, unique SKUs/slugs, uk and en texts, no `TODO(fluxkit)`, valid option/attribute references, synonym words in
  titles, positive integer prices, stock states, tree depth); `seed-command` argument parsing (unit, in `seed.spec.ts` or its own spec).
- Integration (real Postgres, Redis, Meilisearch): `seed.spec.ts` (fixture, unchanged assertions); new `seed-coffee.spec.ts` (coffee dataset:
  counts through the store API, idempotent second run, `MEDIA_STORAGE_DRIVER=none` path, search reindex document count = sellable variants).
- e2e and feature matrix keep the fixture through `--dataset test`.

## Risks

- A consumer missed would silently get the coffee catalog: mitigated by removing `catalogSeed` (compile errors) and the grep table above.
- Image quality is a judgement; the contact sheet is inspected and the honest assessment goes into "Results".
- Repository size: about 2 MB of WebP added (under the budget).
- Fictional brand names could collide with a small real business somewhere; they are invented, not taken from any list.

## Verification

`pnpm lint`, `format:check`, `typecheck`, `check:boundaries`, `check:docs`, `check:env`, `pnpm --filter @fluxkit/theme test`, `pnpm --filter
@fluxkit/seeds test`, `node scripts/generate-coffee-images.mjs --check`; with local services on private ports (Postgres 5600, Redis 6500,
Meilisearch 7900): the API seed specs, `pnpm seed` and `pnpm seed:test` against throwaway databases, search reindex on the coffee dataset; e2e only
if the services run.

## Results

- Datasets: `seeds/src/coffee/` (default of `pnpm seed`, `pnpm demo:up`) and `seeds/src/test-fixture/` (`pnpm seed:test`; files moved with `git mv`,
  each changed by its import path only), shared `seeds/src/shared/shipping.ts`; `seedDatasets`, `DEFAULT_SEED_DATASET`; `catalogSeed` removed.
- Coffee dataset: 90 products, 208 variants, 10 product types, 20 attributes, 8 options, 11 invented brands, 35 categories (11 roots, one third
  level), 16 synonym groups, 3 banners. Products per root: cups and lids 16, straws and stirrers 7, packaging 6, milk and cream 9, ice 3, coffee 11,
  tea and cocoa 5, syrups and sauces 9, equipment 16, cleaning and filters 6, gift cards and guides 2. Stock: 19 low-stock and 7 sold-out
  variants (whole products `grinder-blade`, `descaler-liquid`), one backorder, 4 untracked digital variants; 5 compare-at prices.
- Runner: `--dataset coffee|test` (`datasetOf`, fails on an unknown or missing name before anything is touched), the dataset in the summary line,
  an explicit `sku` of the data through `VariantsService.update` (with `allowBackorder`). Nothing else changed.
- Consumers switched to the fixture: `apps/storefront/e2e/prepare-database.ts`, `apps/admin/e2e/prepare-database.ts`, `scripts/feature-matrix.sh`
  (`search-off`, `search-on`), `apps/api/src/seed/seed.spec.ts`, `apps/api/src/search/store/newest-order.spec.ts`, `apps/api/src/test/seed-rows.ts`
  (dataset parameter, default fixture). `demo-up.mjs` and `demo-pay.mjs` stay on the coffee default. The README checkout walkthrough uses
  `barista-guide-pdf` (it used `demo-e-book`).
- Images: 95 committed WebP files (90 product pictures, one detail picture, 4 banner pictures), 1.3 MB, the largest 22.6 KB; generator
  `scripts/generate-coffee-images.mjs` with `scripts/coffee-images/` (about 55 s for all). A contact sheet was reviewed and the weak archetypes
  redrawn (sugar sticks, napkins, cone filters, brush, group close-up, tin and cleaning labels, syrup and sauce scale). Assessment: cups, lids,
  cold cups, cartons, coffee bags, ice bags, syrups, tins and boxes look like clean vector product illustrations; machines are acceptable front
  views; napkins, the cone dripper, the brush and the group close-up are the weakest (simple and recognisable, not photographic).
- Tests: `seeds` 37 (fixture spec unchanged in substance, `coffee/coffee-seed.spec.ts`, `datasets.spec.ts`); API `seed-dataset.spec.ts` (no
  database: flag parsing, summary line, every picture of both datasets committed and within budget); API integration `seed-coffee.spec.ts` and
  `search/store/coffee-demo-search.spec.ts` written, NOT run here.
- Verified here: `pnpm lint`, `format:check`, `typecheck`, `check:boundaries`, `check:docs`, `check:env`, `pnpm --filter @fluxkit/theme test`,
  `pnpm --filter @fluxkit/seeds test`, the API specs that need no database (`seed-dataset`, `source-guards`), both image `--check`s.
- NOT verified here: Postgres could not be started (the sandbox refuses `runuser` for this worktree-isolated agent), so the seed integration
  specs (fixture and coffee), the coffee search spec, `pnpm seed`/`pnpm seed:test` against a database, the feature matrix and both e2e suites are
  left to CI.
- Decision outside the plan: the shipping methods stay all inactive as today (the request mentioned `demo_courier` active; the reviewer's stack
  had it activated by hand). Product copy promises nothing the template does not do (no "code by e-mail" for the gift card).
