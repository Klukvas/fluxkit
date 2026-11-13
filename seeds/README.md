# seeds (`@fluxkit/seeds`)

Demo data and ProductType presets for the catalog, as pure data. No client data, no real brands, products, domains or images:
every text exists in `uk` and `en`, every image is a drawn illustration in `assets/` (no real brand or person).

This package only describes data (TypeScript objects, no runtime dependencies, types from `@fluxkit/core`). The code that writes it to the database is the runner in `apps/api/src/seed/`.

## Datasets

| Dataset | Command | What it is |
|---|---|---|
| `coffee` (default) | `pnpm seed` (`seed.js`, or `seed.js --dataset coffee`); `pnpm demo:up` | The demo shop: a supplier of coffee shops and coffee-to-go kiosks (owner decision 2026-11-06). `src/coffee/` |
| `test` | `pnpm seed:test` (`seed.js --dataset test`) | The TEST FIXTURE: the small clothing, tools and digital catalog (T-shirt, hammer, e-book, ...) that the API specs, both Playwright suites (`prepare-database.ts`) and the feature matrix (`search-on`, `search-off`) assert. `src/test-fixture/`. Keep its values: tests depend on them |

`--dataset <name>` (or `--dataset=<name>`) picks one; an unknown or missing name fails before anything is touched. The two datasets share
no code, slug, banner id or synonym term (`src/datasets.spec.ts`), only the three demo shipping methods (`src/shared/shipping.ts`), so both
can be seeded into one database.

## Coffee demo (`pnpm seed`)

| Kind | Content |
|---|---|
| Attributes (20) | `src/coffee/dictionaries.ts`: e.g. `ware_material`, `cup_wall`, `ware_color`, `milk_base`, `roast_level`, `coffee_origin`, `processing`, `syrup_flavour`, `machine_kind`, `burr_type` (select, filterable), `fat_content` (number, %, 1 decimal), `arabica_share`, `group_count`, `power_w`, `voltage_v`, `capacity_ml`, `shelf_life_days` (numbers), `storage_notes` (localized text), `digital_format`, and `supplier_code` (**internal**, never public) |
| Options (8) | `volume` (110 ml to 1 l), `pack_size` (1 to 1000 pcs), `net_weight` (100 g to 5 kg), `grind`, `diameter` (straws, lids, tampers), `cup_slots`, `glove_size`, `card_value` |
| ProductType presets (10) | `src/coffee/presets.ts`: `disposable_ware`, `coffee`, `dairy`, `ice`, `grocery`, `syrup_sauce`, `equipment`, `cleaning`, `consumables`, `digital_goods` (`requiresShipping` false). No type names a guide page (`optionGuidePage`), so no product links the size guide. A product picks a subset of its type's options (ADR 0006); simple products keep one default variant |
| Brands (11) | Invented names (`Cuplia`, `Milkora`, `Greenfold`, `Icetta`, `Roast Harbor`, `Leafline`, `Siropia`, `Crema Works`, `Tampwise`, `Cleanbrew`, `Brew School`); no real company or trademark |
| Categories (35) | 11 roots with children, one third level (Coffee > Coffee beans > Espresso blends / Single origin) |
| Products (90, all published) | Cups and lids 16, straws, stirrers and sugar 7, packaging and consumables 6, milk and cream 9, ice 3, coffee 11, tea and cocoa 5, syrups and sauces 9, equipment 16, cleaning and filters 6, gift card and guide 2; 208 variants. `src/coffee/products-*.ts` through the builder `src/coffee/product-builder.ts` |
| SKUs | Explicit and systematic: a stem per product plus the value codes (`CUP-DW-KR-350ML-25`), set through the variant admin service |
| Prices | UAH-like amounts in minor units; 5 variants with a compare-at price |
| Stock | 19 low-stock variants (1 to 5), 7 sold out (two whole products: `grinder-blade`, `descaler-liquid`), one backorder (`espresso-machine-1-group`), the 4 digital variants untracked |
| Images (94) | `assets/coffee/*.webp`, drawn by `scripts/generate-coffee-images.mjs` (parametric SVG archetypes in `scripts/coffee-images/`, studio look, rasterised with the `sharp` of `apps/api`): 90 product pictures plus one detail picture (1200 x 1200) and 3 banner pictures (1280 x 640); 1.3 MB in total, each under 40 KB (`--check`). Committed, because the labels are text and text rendering depends on the machine's fonts and librsvg |
| Shipping methods (3, INACTIVE) | The same three as the test fixture (below) |
| Home banners (3, active) | `src/coffee/banners.ts`: `card` "Everything for coffee to go" (`accent`, link `/c/cups-and-lids`), `card` "Coffee for espresso and filter" (link `/c/coffee`, decorative picture), `card` "Equipment for your cafe" (link `/c/equipment`, decorative picture; an `image` banner until 2026-11-13, and a database seeded before keeps it: the runner never overwrites a banner it finds by id, switch it in `/admin/banners`); fixed ids `5eedba22-0000-4000-8000-0000000c0f0N` |
| Search synonym groups (16, ONLY with `SEARCH_ENABLED=true`) | `src/coffee/synonyms.ts`: only words of the coffee titles, e.g. `стаканчик`/`стакан`, `трубочка`/`соломинка`/`соломка`, `кавомашина`/`кофемашина`, `лід`/`льоду`/`лёд`/`лед`, `вершки`/`сливки`; `en` `pitcher`/`jug`, `decaf`/`decaffeinated` |

Change a picture: edit its archetype or its entry in `scripts/coffee-images/catalog.mjs`, run `node scripts/generate-coffee-images.mjs --only <prefix>`,
look at it (`--sheet <file.png>` writes a contact sheet of all of them) and commit the WebP.

## Test fixture (`pnpm seed:test`)

The tables below describe the fixture (`src/test-fixture/`), unchanged since it was the demo catalog.


| Kind | Content |
|---|---|
| Attributes (8) | `material` (select, filterable), `care_notes` (localized text), `supplier_reference` (**internal**, never public), `head_type` (select, filterable), `length` (number, mm), `weight` (number, g), `file_format` (select), `license_type` (select) |
| Options (2) | `color` (black, white, red, blue), `size` (s, m, l, xl) |
| ProductType presets (3) | `clothing` (options color + size; material required; guide page `size-guide`, so the storefront links its size guide next to the pickers; a database seeded before 2026-11-13 keeps its type WITHOUT a guide page, because the runner never overwrites an existing type: set it in the admin), `hand_tool` (no options; head type required; `requiresShipping` true), `digital_product` (no options; `requiresShipping` false; file format required) |
| Brand (1) | `demo-brand` ("Demo Brand") |
| Categories (9) | 3 roots (`demo-clothing`, `demo-tools`, `demo-digital-goods`), 2 children each |
| Products (8, all published) | 3 clothing (variants: 9, 8 and 4), 3 hand tools and 2 digital products (one default variant each); 26 variants in total |
| Images (11) | `assets/*.webp`, 800 x 800, 74 KB in total: one per product (T-shirt in white, black and red; grey hoodie; linen shirt in white and blue; screwdriver, hammer, adjustable wrench; e-book reader, template pack). Four are tied to a colour (`optionValue`), the others are gallery images. Drawn by `scripts/generate-demo-images.mjs` (SVG rendered with the `sharp` of `apps/api`; `--check` lists missing files). Committed as seed data, because SVG rendering depends on the local librsvg; regenerate only when a drawing changes (`--only <prefix>` writes only matching files, e.g. `--only banner-`). The media service accepts JPEG, PNG and WebP, never SVG |
| Prices (26) | One price per variant, differing by product, color and size, as integer minor units without a currency (59900 is 599.00 in a two-decimal currency). The runner stores them in `SHOP_CURRENCY`. Three variants also have a `compareAtAmount` (an old, higher price) |
| Stock | Received into the default location `main` for every tracked variant that has any. Digital products are untracked (no stock, always `in_stock`) |
| Shipping methods (3, all INACTIVE) | `demo_courier` "Courier (demo)" (address, 90.00, free from 2 000.00), `demo_pickup_point` "Pickup point (demo)" (pickup point of the TEST-ONLY `fake` provider, 60.00; created only when `SHIPPING_PROVIDERS_ENABLED` contains `fake`, else skipped and reported), `demo_store_pickup` "Store pickup (demo)" (free, pickup text); all for `UA`, placeholder prices in minor units of `SHOP_CURRENCY`. Activate them in the admin (Shipping) to show the delivery step; while they are inactive the checkout is the one without methods. An active pickup point method whose provider is not loaded is not offered, so it cannot lock the checkout out |
| Home banners (3, active; ADR 0046) | `src/test-fixture/banners.ts`, shown by the storefront's default home (`source: "admin"`): `card` "New this season" / "Новинки сезону" (`accent`, picture with alt text, link `/catalog`), `card` "Gift ideas" / "Ідеї для подарунків" (`surface`, decorative picture, link `/catalog?price=..50000`: the catalog filtered by price up to 500.00, minor units as the storefront writes its price filter; it was `/c/demo-clothing` before 2026-11-06, and a database seeded before keeps that link because the runner never overwrites a banner it finds by id: edit it in `/admin/banners`), `image` "New collection" (a finished picture with its words drawn in: the default picture in Ukrainian, an own `en` picture in English; the same words are its alt text in each language; link `/catalog`). The card texts say `TODO(fluxkit)`: replace or delete them (`/admin/banners`; the admin screen comes with PR 2 of the plan). Pictures `assets/banner-*.webp` (1280 x 640, 2:1, 35 KB for 4 files). Not created with `MEDIA_STORAGE_DRIVER=none` (a banner needs a picture) |
| Search synonym groups (14, ONLY with `SEARCH_ENABLED=true`) | `src/test-fixture/synonyms.ts`, generic words (ADR 0034 decision 8): `uk` `нога`/`ноги`/`нозі` (the alternation the Ukrainian stemmer cannot reach, ADR 0034 decision 6), `викрутка`/`відвертка`/`отвертка`, `сорочка`/`рубашка` (a Russian query word), `худі`/`толстовка`/`худи`, and Russian words for the demo titles (2026-11-06): `розвідний`/`разводной`, `лляна`/`льняная`, `електронна`/`электронная` (none for "gift": no product has the word; a database seeded before gets the three new groups but not `отвертка` and `худи`, because their groups already exist); `en` irregular forms `scarf`/`scarves`, `knife`/`knives`, `mouse`/`mice`, `man`/`men`, `woman`/`women`, `foot`/`feet`, and `wrench`/`spanner`. Written through the admin search service (the rules of `POST /admin/search/synonyms`); applied to the index by job 13 (`pnpm search:reindex`) as an in-place settings update |

Stock states the demo shows in the store (default `LOW_STOCK_THRESHOLD` of 5):

| State | Where |
|---|---|
| `in_stock` | most clothing variants, the screwdriver (120), the digital products (untracked) |
| `low_stock` | T-shirt black/s (3), hoodie black/xl (5, the threshold itself), hoodie blue/s (2), the hammer (4) |
| `out_of_stock` | T-shirt red/l (tracked, stock 0), the adjustable wrench (tracked, stock 0: its product is listed as `out_of_stock`) |
| backorder (`in_stock` with no stock) | linen shirt blue/m (`allowBackorder`, stock 0) |

## Run it

The database must be migrated first with `pnpm db:migrate` (applies the migrations in `apps/api/drizzle/`, forward only; see `README.md`, Database migrations).

```bash
cp .env.example .env     # DATABASE_URL must point at the database you migrate and seed
pnpm db:migrate          # = pnpm build && pnpm --filter @fluxkit/api db:migrate
pnpm seed                # coffee demo: = pnpm build && pnpm --filter @fluxkit/api seed (node dist/seed/seed.js, no ts-node)
pnpm seed:test           # test fixture: = pnpm build && pnpm --filter @fluxkit/api seed:test (seed.js --dataset test)
```

The runner reads the same environment as the API (`DATABASE_URL`, `DEFAULT_LOCALE`, `LOCALES`; the root `.env` through Node's `--env-file`) and invents no defaults for missing variables.
With `SEARCH_ENABLED=true` the seeded products are also marked for the search index like any admin write, and the demo synonym groups are created; run `pnpm search:reindex` afterwards to build the index and apply the groups at once (otherwise the scheduler does it at its next ticks). With search off the seed writes nothing to the search tables (no queue row, no synonym group; the summary says "synonym groups not written: search is off"), which the feature matrix mode `search-off` checks.
It prints how many entities were created and how many already existed. Any error is printed in full (including the field errors of the admin API) and the exit code is 1.

## Rules of the runner

- **Same rules as the admin API.** It boots the real application module (no HTTP server) and creates everything through the admin services, with the same request schemas.
  Seed data therefore passes exactly the validation and the core rules (attribute values, variants, publish preconditions) that any admin request does.
- **Idempotent.** Each entity is looked up by its stable code or slug and created only when missing. A second run changes nothing (no new rows in any table) and does not fail.
- **No overwrite, no delete.** An entity that exists is left exactly as it is, with all its children (a product is never touched again, an attribute keeps its options, even when you edited them).
  The seed never updates or removes anything. Consequence: a run that crashed halfway can leave a half-built product. Its repair, in the admin (Catalog, Products, open the product): a product that was never published has a "Delete" action (lifecycle buttons at the top); delete it and run `pnpm seed` again. A published one cannot be deleted: add its images on the Media tab ("Upload images", files from `seeds/assets/`, then "Save the images"). The seed summary lists every existing demo product that has no image (`images missing on existing products: <slugs>`).
- **Production guard.** The runner refuses to start (non-zero exit, before it touches the database) when `NODE_ENV` is `production` (trimmed, any letter case), or when the name of the
  database in `DATABASE_URL` does not end in `_test`, `_dev`, `_demo` or `_local`. `--allow-production` is the single override for both:
  `pnpm --filter @fluxkit/api seed --allow-production` after a build. Demo data does not belong in a client's production database.
  Note: the database name `fluxkit` from `.env.example` does not match the suffix rule, so either name your database `fluxkit_dev` (or similar) or pass the flag.
- **SKUs.** A variant with a `sku` in the data (the coffee demo) gets it through the variant admin service (the rules of `PATCH /admin/products/{id}/variants/{variantId}`), together with `allowBackorder`, before publishing; without one (the test fixture) the SKU core proposes from the slug and the value codes stays.
- **Prices.** A product cannot be published without a price in `SHOP_CURRENCY` on every active variant, so for each product it creates the runner writes the prices from the seed data (matched to the generated variants by option values) through `PricesService`, before publishing. The amounts are the same whatever `SHOP_CURRENCY` is; pick the currency, the amounts are not converted. Existing products are never repriced and never priced: on a database seeded before prices existed, the store stays empty until the variants are priced with the bulk price endpoint.
- **Stock.** For each stocked variant of a product it creates, the runner receives the stock through the real admin inventory service: one `receipt` movement with the reason "Demo seed" at the default location, so the journal replays to the level. The seed has no admin user, so these movements have no actor (`actorId` is `null`; `InventoryService.adjust` accepts a `null` actor for system changes). A tracked variant with stock 0 gets no level and no movement (that absence is "out of stock"). `allowBackorder` is set through the variant admin service. Existing variants are never restocked: a second run adds no price, level or movement.
- **Images.** The runner reads the `MEDIA_*` variables like the API (outside production the default is the local driver in `<repo>/var/media`, created when missing, and `http://127.0.0.1:<PORT>/media`). For each product it creates, it reads the product's files from `seeds/assets/` first (a missing file stops the run before anything is written), creates the product, uploads each file through the real media service (`MediaUploadService.storeSystemImage`: the same type gate, re-encode without metadata, random key and `media_upload` row as `POST /admin/media/uploads`, with no admin: `created_by` is null) and saves the returned URLs through the product media rules (`PUT /admin/products/{id}/media`), which mark the uploads attached. Existing products get nothing, so a second run uploads nothing. With `MEDIA_STORAGE_DRIVER=none` the products are created WITHOUT images and the summary says `images not uploaded: MEDIA_STORAGE_DRIVER is none`; a later run with `local` does not add them, and its summary names them (`images missing on existing products`); repair them as described above (admin Media tab, or delete a never-published one and seed again). A database seeded before images existed keeps the old `https://example.com/placeholder/...` URLs for the same reason. An upload that fails after its product was created leaves a half-built product (see above) and an unattached upload, which job 7 deletes after 24 hours. Keep `MEDIA_DIR` and `MEDIA_PUBLIC_BASE_URL` equal to the API's, or the API cannot serve the files. The admin shows the images. The storefront shows them in `next dev` through its development-only `/media` rewrite (README, "Try it locally"), and in a production build only over `https` from a host in `STOREFRONT_IMAGE_HOSTS` that resolves to a public address (README, "Uploaded images").
- Optional feature modules are not loaded while seeding. Shipping providers are: the runner loads the ones in `SHIPPING_PROVIDERS_ENABLED`, as the API does (`fake` is refused under `NODE_ENV=production` anyway).
- **Synonym groups** (search on only) have no code: a demo group counts as existing when ANY of its terms is already in a group of its locale, so a group an admin edited (one demo term kept) is left alone and a deleted one is created again. No term repeats across the demo groups of a locale (`pnpm --filter @fluxkit/seeds test`). Groups of a locale outside `LOCALES` are skipped and reported. The runner reaches the admin search service through `SEARCH_SYNONYM_SEEDER` (`apps/api/src/common/search-port.ts`), never by importing `apps/api/src/search/`.
- **Home banners** have no code or slug, so the seed gives each a fixed id (`banners.ts` of the dataset): a banner with that id is left alone (also when an admin changed or deactivated it), a deleted one is created again at the end of the list. They are created through the admin banner service (the rules of `POST /admin/banners`: core's link, text and layout checks, the 50 cap), last in the run and after any banner the shop already has. The service generates ids, so the runner creates the banner INACTIVE, gives it the fixed id with one `UPDATE` (the only write outside an admin service; nothing refers to the new row yet), then adds its own locale pictures and activates it through the service. A run that stops in between leaves an inactive banner the storefront never shows; delete it and seed again. Its pictures are read first, uploaded like the product images and marked attached by the service (job 7 never deletes them).
- **Shipping methods** are created inactive through the admin shipping service (same rules as `POST /admin/shipping/methods`); an existing method (by code) is left as it is, also when an admin activated or changed it.
- With `MEDIA_STORAGE_DRIVER=none` no demo banner is created (`images not uploaded: ... home banners not created`); the storefront then shows no banners.
- Seeding creates no users, no customers, no carts, no orders and no shipments (no personal or fake order data in the template). The first admin owner comes from `pnpm admin:create` (README, Admin sign-in); a cart, a customer and an order come from the curl run in the README, Checkout walkthrough.

## Add or change a preset

The demo shop lives in `src/coffee/` (change it freely, keeping `coffee-seed.spec.ts` green); the test fixture in `src/test-fixture/` changes only together with the tests that assert it.

1. Add attributes or options to `dictionaries.ts` of the dataset (codes are immutable and match `^[a-z][a-z0-9_]{0,63}$`; value codes may start with a digit).
2. Add the ProductType to `presets.ts`: which attributes (product or variant level, required or not) and which options it allows. Niche-specific fields live here as data, never in the product schema.
3. Add demo products (`products-*.ts` through `coffeeProduct()` in the coffee demo, `products.ts` in the fixture) and categories or brands to `taxonomy.ts`; give every text a `uk` and an `en` value, and one `variants` entry (option values, price, stock) for every variant the options generate.
4. `pnpm --filter @fluxkit/seeds test` checks codes, slugs, texts and references; the integration tests `apps/api/src/seed/seed-coffee.spec.ts` (coffee) and `seed.spec.ts` (fixture) seed a real database and reads the result through the store API.

A client fork replaces this content with its own presets and products; core and the runner stay unchanged.
