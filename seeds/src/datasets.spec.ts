import { describe, expect, it } from "vitest";
import { DEFAULT_SEED_DATASET, coffeeCatalogSeed, seedDatasets, testCatalogSeed } from "./index.js";
import type { CatalogSeed, SeedCategory } from "./types.js";

function keys(seed: CatalogSeed): string[] {
  const categories = (nodes: readonly SeedCategory[]): string[] =>
    nodes.flatMap((node) => [node.slug, ...categories(node.children ?? [])]);
  return [
    ...seed.attributes.map((item) => `attribute:${item.code}`),
    ...seed.options.map((item) => `option:${item.code}`),
    ...seed.productTypes.map((item) => `type:${item.code}`),
    ...seed.brands.map((item) => `brand:${item.slug}`),
    ...categories(seed.categories).map((slug) => `category:${slug}`),
    ...seed.products.map((item) => `product:${item.slug}`),
    ...seed.banners.map((item) => `banner:${item.id}`),
    ...seed.synonymGroups.flatMap((group) =>
      group.terms.map((term) => `synonym:${group.locale}:${term}`),
    ),
  ];
}

describe("seed datasets", () => {
  it("are the coffee demo (default of pnpm seed) and the test fixture (pnpm seed:test)", () => {
    expect(Object.keys(seedDatasets).sort()).toEqual(["coffee", "test"]);
    expect(DEFAULT_SEED_DATASET).toBe("coffee");
    expect(seedDatasets.coffee).toBe(coffeeCatalogSeed);
    expect(seedDatasets.test).toBe(testCatalogSeed);
  });

  it("share nothing but the demo shipping methods, so both can be seeded into one database", () => {
    const fixture = new Set(keys(testCatalogSeed));
    expect(keys(coffeeCatalogSeed).filter((key) => fixture.has(key))).toEqual([]);
    expect(coffeeCatalogSeed.shippingMethods).toBe(testCatalogSeed.shippingMethods);
  });
});
