import { Module } from "@nestjs/common";
import { AttributesModule } from "./admin/attributes/attributes.module.js";
import { BrandsModule } from "./admin/brands/brands.module.js";
import { CategoriesModule } from "./admin/categories/categories.module.js";
import { OptionsModule } from "./admin/options/options.module.js";
import { ProductOptionsModule } from "./admin/product-options/product-options.module.js";
import { ProductTypesModule } from "./admin/product-types/product-types.module.js";
import { ProductsModule } from "./admin/products/products.module.js";
import { VariantsModule } from "./admin/variants/variants.module.js";
import { StoreModule } from "./store/store.module.js";

/** Core catalog (no feature flag). Each admin resource is its own module; the public read API is `StoreModule`. */
@Module({
  imports: [
    AttributesModule,
    BrandsModule,
    CategoriesModule,
    OptionsModule,
    ProductTypesModule,
    ProductOptionsModule,
    ProductsModule,
    VariantsModule,
    StoreModule,
  ],
})
export class CatalogModule {}
