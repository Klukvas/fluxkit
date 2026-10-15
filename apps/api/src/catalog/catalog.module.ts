import { Module } from "@nestjs/common";
import { AttributesModule } from "./admin/attributes/attributes.module.js";
import { BrandsModule } from "./admin/brands/brands.module.js";

/** Core catalog (no feature flag). Each admin resource is its own module; add new ones to this list. */
@Module({ imports: [AttributesModule, BrandsModule] })
export class CatalogModule {}
