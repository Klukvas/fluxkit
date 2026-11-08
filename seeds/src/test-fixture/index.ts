import { demoShippingMethods } from "../shared/shipping.js";
import type { CatalogSeed } from "../types.js";
import { demoBanners } from "./banners.js";
import { demoAttributes, demoOptions } from "./dictionaries.js";
import { productTypePresets } from "./presets.js";
import { demoProducts } from "./products.js";
import { demoSynonymGroups } from "./synonyms.js";
import { demoBrands, demoCategories } from "./taxonomy.js";

/**
 * The TEST FIXTURE dataset (`pnpm seed:test`, `seed.js --dataset test`): the small clothing, tools and digital catalog that the
 * unit, integration and e2e tests and the feature matrix rely on (a T-shirt with colour and size options, low stock, a sold-out
 * wrench, a digital e-book without delivery, search synonyms). Keep its values as they are: tests assert them.
 */
export const testCatalogSeed: CatalogSeed = {
  attributes: demoAttributes,
  options: demoOptions,
  productTypes: productTypePresets,
  brands: demoBrands,
  categories: demoCategories,
  products: demoProducts,
  shippingMethods: demoShippingMethods,
  synonymGroups: demoSynonymGroups,
  banners: demoBanners,
};
