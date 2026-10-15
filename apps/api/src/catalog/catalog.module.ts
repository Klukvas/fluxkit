import { Module } from "@nestjs/common";
import { AttributesModule } from "./admin/attributes/attributes.module.js";
import { BrandsModule } from "./admin/brands/brands.module.js";
import { CategoriesModule } from "./admin/categories/categories.module.js";
import { OptionsModule } from "./admin/options/options.module.js";
import { ProductTypesModule } from "./admin/product-types/product-types.module.js";

/** Core catalog (no feature flag). Each admin resource is its own module; add new ones to this list. */
@Module({
  imports: [AttributesModule, BrandsModule, CategoriesModule, OptionsModule, ProductTypesModule],
})
export class CatalogModule {}
