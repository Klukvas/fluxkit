# seeds (`@fluxkit/seeds`)

- `package.json` - private workspace package; no runtime dependencies (`@fluxkit/core` is a dev dependency for types and for the data checks).
- `src/types.ts` - data shapes of the seed (`CatalogSeed`, `SeedProduct`, `SeedVariantCommerce` with an optional explicit `sku`, `SeedBanner`, ...). Entities refer to each other by code or slug, never by id; a variant is identified by its option values. The one exception: a demo banner has a fixed id (banners have no code or slug).
- `src/index.ts` - public entry: `coffeeCatalogSeed`, `testCatalogSeed`, `seedDatasets` (`coffee`, `test`), `DEFAULT_SEED_DATASET` (`coffee`), the named parts of the test fixture and the types. Must contain no I/O and no client data.
- `src/datasets.spec.ts` - the two datasets and the default; they share no code, slug, banner id or synonym term, only the shipping methods.
- `src/shared/shipping.ts` - the demo delivery methods of both datasets (`demo_courier` address, `demo_pickup_point` with the test-only `fake` provider, `demo_store_pickup`), placeholder texts and prices; the runner creates them inactive.

## `src/coffee/` - the demo shop of `pnpm seed` (coffee-shop supplies)

- `index.ts` - `coffeeCatalogSeed`.
- `dictionaries.ts` - 20 attributes (select, number, localized text; `supplier_code` internal) and 8 options (`volume`, `pack_size`, `net_weight`, `grind`, `diameter`, `cup_slots`, `glove_size`, `card_value`). Codes differ from the fixture's.
- `presets.ts` - 10 ProductType presets (`disposable_ware`, `coffee`, `dairy`, `ice`, `grocery`, `syrup_sauce`, `equipment`, `cleaning`, `consumables`, `digital_goods`).
- `taxonomy.ts` - 11 invented brands and the category tree (35 categories, one third level).
- `product-builder.ts` - `coffeeProduct()`: a compact product spec to a `SeedProduct` (every option combination, systematic SKUs `<STEM>-<VALUE CODES>`, the picture `coffee/<slug>.webp`); a combination without a price fails when the module loads. Must stay pure data building.
- `products-ware.ts`, `products-food.ts`, `products-equipment.ts` - the 90 products (uk and en texts, prices in minor units, stock, compare-at prices, one backorder, digital goods untracked).
- `synonyms.ts` - 16 synonym groups, only for words of the coffee titles. `banners.ts` - three home banners with fixed ids and `coffee/banner-*.webp` pictures.
- `coffee-seed.spec.ts` - data checks: at least 70 products, tree depth, unique valid codes, slugs and SKUs, uk and en texts, no `TODO`/URL, references and required attributes, options a subset of the type's, picture paths `coffee/<name>.webp` once per product (that the files exist and stay under 40 KB is checked in `apps/api/src/seed/seed-dataset.spec.ts`), variants per combination, positive integer prices, every stock state, synonym groups valid and found in titles, banners valid by core rules and linking existing categories.

## `src/test-fixture/` - the test fixture of `pnpm seed:test` (values asserted by tests; change only with them)

- `index.ts` - `testCatalogSeed`.
- `dictionaries.ts` - attributes (with select options) and options (color, size). `presets.ts` - `clothing`, `hand_tool`, `digital_product`. `taxonomy.ts` - one brand and the two-level category tree.
- `products.ts` - 8 products (placeholder texts, image files of `assets/`) with the price, compare-at price, stock and backorder flag of every variant; SKUs proposed by core.
- `synonyms.ts` - synonym groups (generic words, the `нозі` stemmer miss, irregular English plurals, Russian query words of the fixture titles). `banners.ts` - three home banners with fixed ids.
- `catalog-seed.spec.ts` - the data checks of the fixture (unchanged in substance).

## Assets

- Seeds create no customers, carts or orders (the runner in `apps/api/src/seed/` writes catalog, price, stock, inactive demo shipping method and demo home banner data only; the README Checkout walkthrough shows the cart and order flow).
- `assets/*.webp` - the fixture pictures (committed, drawn by `scripts/generate-demo-images.mjs`): 11 product illustrations (800 x 800) and 4 banner pictures (1280 x 640).
- `assets/coffee/*.webp` - the coffee pictures (committed, drawn by `scripts/generate-coffee-images.mjs`): 91 product pictures (1200 x 1200) and 4 banner pictures (1280 x 640), 1.3 MB. The media service accepts no SVG; the runner uploads the WebP through it.
- `README.md` - the datasets, what is seeded, how to run it, runner rules, how to add a preset.
