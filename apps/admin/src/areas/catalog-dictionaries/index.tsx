/**
 * Catalog dictionaries area (plan step 5): one lazy chunk for the screens of attributes, options, product types, brands
 * and categories (a list or tree, a create form and an editor each). The route table names these exports.
 */
import type { LazyFile } from "../../messages";

/** The area's strings (`dict.*`) load with its chunk. */
export const MESSAGE_FILES: readonly LazyFile[] = ["catalog-dictionaries"];

export { AttributeDetailPage, AttributeNewPage, AttributesPage } from "./attributes-page";
export { BrandDetailPage, BrandNewPage, BrandsPage } from "./brands-page";
export { CategoriesPage, CategoryDetailPage, CategoryNewPage } from "./categories-page";
export { OptionDetailPage, OptionNewPage, OptionsPage } from "./options-page";
export { ProductTypeDetailPage, ProductTypeNewPage, ProductTypesPage } from "./product-types-page";
