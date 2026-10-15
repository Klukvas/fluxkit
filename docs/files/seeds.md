# seeds (`@fluxkit/seeds`)

- `package.json` - private workspace package; no runtime dependencies (`@fluxkit/core` is a dev dependency for types and for the data checks).
- `src/types.ts` - data shapes of the seed (`CatalogSeed`, `SeedProduct`, ...). Entities refer to each other by code or slug, never by id.
- `src/dictionaries.ts` - demo attributes (with select options) and options (color, size).
- `src/presets.ts` - ProductType presets: `clothing`, `hand_tool`, `digital_product`.
- `src/taxonomy.ts` - demo brand and the two-level category tree.
- `src/products.ts` - demo products (placeholder texts in `uk` and `en`, `https://example.com/placeholder/...` images).
- `src/index.ts` - public entry: `catalogSeed` plus the parts and types. Must contain no I/O and no client data.
- `src/catalog-seed.spec.ts` - data checks: unique and valid codes and slugs, `uk`+`en` texts, references resolve, no host other than `example.com`.
- `README.md` - what is seeded, how to run it, runner rules, how to add a preset.
