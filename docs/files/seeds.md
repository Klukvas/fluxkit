# seeds (`@fluxkit/seeds`)

- `package.json` - private workspace package; no runtime dependencies (`@fluxkit/core` is a dev dependency for types and for the data checks).
- `src/types.ts` - data shapes of the seed (`CatalogSeed`, `SeedProduct`, `SeedVariantCommerce`, ...). Entities refer to each other by code or slug, never by id; a variant is identified by its option values.
- `src/dictionaries.ts` - demo attributes (with select options) and options (color, size).
- `src/presets.ts` - ProductType presets: `clothing`, `hand_tool`, `digital_product`.
- `src/taxonomy.ts` - demo brand and the two-level category tree.
- `src/products.ts` - demo products (placeholder texts in `uk` and `en`, `https://example.com/placeholder/...` images) with the price, compare-at price, stock and backorder flag of every variant. Amounts are minor units without a currency.
- `src/index.ts` - public entry: `catalogSeed` plus the parts and types. Must contain no I/O and no client data.
- `src/catalog-seed.spec.ts` - data checks: unique and valid codes and slugs, `uk`+`en` texts, references resolve, no host other than `example.com`, one price entry per generated variant, price and stock limits, stock only for tracked variants, every store availability state present.
- Seeds create no customers, carts or orders (the runner in `apps/api/src/seed/` writes catalog, price and stock data only; the README Checkout walkthrough shows the cart and order flow).
- `README.md` - what is seeded, how to run it, runner rules, how to add a preset.
