import { Module } from "@nestjs/common";
import { BrandsModule } from "./admin/brands/brands.module.js";

/** Core catalog (no feature flag). Each admin resource is its own module; add new ones to this list. */
@Module({ imports: [BrandsModule] })
export class CatalogModule {}
