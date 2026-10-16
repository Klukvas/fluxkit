# seeds (`@fluxkit/seeds`)

Demo data and ProductType presets for the catalog, as pure data. No client data, no real brands, products, domains or images:
every text exists in `uk` and `en`, every image URL is `https://example.com/placeholder/<name>.jpg`.

This package only describes data (TypeScript objects, no runtime dependencies, types from `@fluxkit/core`). The code that writes it to the database is the runner in `apps/api/src/seed/`.

## What is seeded

| Kind | Content |
|---|---|
| Attributes (8) | `material` (select, filterable), `care_notes` (localized text), `supplier_reference` (**internal**, never public), `head_type` (select, filterable), `length` (number, mm), `weight` (number, g), `file_format` (select), `license_type` (select) |
| Options (2) | `color` (black, white, red, blue), `size` (s, m, l, xl) |
| ProductType presets (3) | `clothing` (options color + size; material required), `hand_tool` (no options; head type required; `requiresShipping` true), `digital_product` (no options; `requiresShipping` false; file format required) |
| Brand (1) | `demo-brand` ("Demo Brand") |
| Categories (9) | 3 roots (`demo-clothing`, `demo-tools`, `demo-digital-goods`), 2 children each |
| Products (8, all published) | 3 clothing (variants: 9, 8 and 4), 3 hand tools and 2 digital products (one default variant each); 26 variants in total |
| Prices (26) | One price per variant, differing by product, color and size, as integer minor units without a currency (59900 is 599.00 in a two-decimal currency). The runner stores them in `SHOP_CURRENCY`. Three variants also have a `compareAtAmount` (an old, higher price) |
| Stock | Received into the default location `main` for every tracked variant that has any. Digital products are untracked (no stock, always `in_stock`) |

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
pnpm seed                # = pnpm build && pnpm --filter @fluxkit/api seed (node dist/seed/seed.js, no ts-node)
```

The runner reads the same environment as the API (`DATABASE_URL`, `DEFAULT_LOCALE`, `LOCALES`; the root `.env` through Node's `--env-file`) and invents no defaults for missing variables.
It prints how many entities were created and how many already existed. Any error is printed in full (including the field errors of the admin API) and the exit code is 1.

## Rules of the runner

- **Same rules as the admin API.** It boots the real application module (no HTTP server) and creates everything through the admin services, with the same request schemas.
  Seed data therefore passes exactly the validation and the core rules (attribute values, variants, publish preconditions) that any admin request does.
- **Idempotent.** Each entity is looked up by its stable code or slug and created only when missing. A second run changes nothing (no new rows in any table) and does not fail.
- **No overwrite, no delete.** An entity that exists is left exactly as it is, with all its children (a product is never touched again, an attribute keeps its options, even when you edited them).
  The seed never updates or removes anything. Consequence: a run that crashed halfway can leave a half-built product; delete it in the admin and run the seed again.
- **Production guard.** The runner refuses to start (non-zero exit, before it touches the database) when `NODE_ENV` is `production` (trimmed, any letter case), or when the name of the
  database in `DATABASE_URL` does not end in `_test`, `_dev`, `_demo` or `_local`. `--allow-production` is the single override for both:
  `pnpm --filter @fluxkit/api seed --allow-production` after a build. Demo data does not belong in a client's production database.
  Note: the database name `fluxkit` from `.env.example` does not match the suffix rule, so either name your database `fluxkit_dev` (or similar) or pass the flag.
- **Prices.** A product cannot be published without a price in `SHOP_CURRENCY` on every active variant, so for each product it creates the runner writes the prices from the seed data (matched to the generated variants by option values) through `PricesService`, before publishing. The amounts are the same whatever `SHOP_CURRENCY` is; pick the currency, the amounts are not converted. Existing products are never repriced.
- **Stock.** For each stocked variant of a product it creates, the runner receives the stock through the real admin inventory service: one `receipt` movement with the reason "Demo seed" at the default location, so the journal replays to the level. The seed has no admin user, so these movements have no actor (`actorId` is `null`; `InventoryService.adjust` accepts a `null` actor for system changes). A tracked variant with stock 0 gets no level and no movement (that absence is "out of stock"). `allowBackorder` is set through the variant admin service. Existing variants are never restocked: a second run adds no price, level or movement.
- Optional feature modules are not loaded while seeding.
- Seeding creates no users. The first admin owner comes from `pnpm admin:create` (README, Admin sign-in).

## Add or change a preset

1. Add attributes or options to `src/dictionaries.ts` (codes are immutable and match `^[a-z][a-z0-9_]{0,63}$`; value codes may start with a digit).
2. Add the ProductType to `src/presets.ts`: which attributes (product or variant level, required or not) and which options it allows. Niche-specific fields live here as data, never in the product schema.
3. Add demo products to `src/products.ts` and categories or brands to `src/taxonomy.ts`; give every text a `uk` and an `en` value, and one `variants` entry (option values, price, stock) for every variant the options generate.
4. `pnpm --filter @fluxkit/seeds test` checks codes, slugs, texts and references; the integration test `apps/api/src/seed/seed.spec.ts` seeds a real database and reads the result through the store API.

A client fork replaces this content with its own presets and products; core and the runner stay unchanged.
