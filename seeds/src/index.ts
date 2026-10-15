import { demoAttributes, demoOptions } from "./dictionaries.js";
import { productTypePresets } from "./presets.js";
import { demoProducts } from "./products.js";
import { demoBrands, demoCategories } from "./taxonomy.js";
import type { CatalogSeed } from "./types.js";

export { demoAttributes, demoOptions } from "./dictionaries.js";
export { productTypePresets } from "./presets.js";
export { INTERNAL_SUPPLIER_MARKER, demoProducts } from "./products.js";
export { demoBrands, demoCategories } from "./taxonomy.js";
export type * from "./types.js";

/** Everything the seed runner creates, in one object. Pure data: no I/O and no runtime dependencies. */
export const catalogSeed: CatalogSeed = {
  attributes: demoAttributes,
  options: demoOptions,
  productTypes: productTypePresets,
  brands: demoBrands,
  categories: demoCategories,
  products: demoProducts,
};
