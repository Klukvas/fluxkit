import { coffeeCatalogSeed } from "./coffee/index.js";
import { testCatalogSeed } from "./test-fixture/index.js";
import type { CatalogSeed } from "./types.js";

export { coffeeCatalogSeed } from "./coffee/index.js";
export { testCatalogSeed } from "./test-fixture/index.js";
export { demoShippingMethods } from "./shared/shipping.js";
// Named parts of the TEST FIXTURE dataset (tests read them).
export { demoBanners } from "./test-fixture/banners.js";
export { demoAttributes, demoOptions } from "./test-fixture/dictionaries.js";
export { productTypePresets } from "./test-fixture/presets.js";
export { INTERNAL_SUPPLIER_MARKER, demoProducts } from "./test-fixture/products.js";
export { demoSynonymGroups } from "./test-fixture/synonyms.js";
export { demoBrands, demoCategories } from "./test-fixture/taxonomy.js";
export type * from "./types.js";

/** The datasets the seed runner can write (`seed.js --dataset <name>`). Pure data: no I/O and no runtime dependencies. */
export const seedDatasets = {
  /** The demo shop: coffee-shop supplies. The default of `pnpm seed` and `pnpm demo:up`. */
  coffee: coffeeCatalogSeed,
  /** The test fixture (`pnpm seed:test`): what the tests, the e2e suites and the feature matrix assert. */
  test: testCatalogSeed,
} as const satisfies Readonly<Record<string, CatalogSeed>>;

export type SeedDatasetName = keyof typeof seedDatasets;

/** The dataset of `pnpm seed` when no `--dataset` is given. */
export const DEFAULT_SEED_DATASET: SeedDatasetName = "coffee";
