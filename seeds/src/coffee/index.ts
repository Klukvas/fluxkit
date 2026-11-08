import { demoShippingMethods } from "../shared/shipping.js";
import type { CatalogSeed } from "../types.js";
import { coffeeBanners } from "./banners.js";
import { coffeeAttributes, coffeeOptions } from "./dictionaries.js";
import { coffeeProductTypes } from "./presets.js";
import { coffeeEquipmentProducts } from "./products-equipment.js";
import { coffeeFoodProducts } from "./products-food.js";
import { coffeeWareProducts } from "./products-ware.js";
import { coffeeSynonymGroups } from "./synonyms.js";
import { coffeeBrands, coffeeCategories } from "./taxonomy.js";

/**
 * The demo shop of `pnpm seed` and `pnpm demo:up`: a supplier of coffee shops and coffee-to-go kiosks (cups, lids, straws,
 * milk, ice, coffee, syrups, machines, tools, cleaning products and packaging). Invented brands, placeholder-like copy, drawn
 * pictures; a client fork replaces it with its own catalog. The shipping methods are the same three as in the test fixture.
 */
export const coffeeCatalogSeed: CatalogSeed = {
  attributes: coffeeAttributes,
  options: coffeeOptions,
  productTypes: coffeeProductTypes,
  brands: coffeeBrands,
  categories: coffeeCategories,
  products: [...coffeeWareProducts, ...coffeeFoodProducts, ...coffeeEquipmentProducts],
  shippingMethods: demoShippingMethods,
  synonymGroups: coffeeSynonymGroups,
  banners: coffeeBanners,
};
