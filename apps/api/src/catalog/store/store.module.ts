import { Module } from "@nestjs/common";
import { StoreCategoriesController } from "./store-categories.controller.js";
import { StoreProductsController } from "./store-products.controller.js";
import { StoreRepository } from "./store.repository.js";
import { StoreService } from "./store.service.js";

/** Public, read-only catalog API under `/store`. No authentication by design. */
@Module({
  controllers: [StoreCategoriesController, StoreProductsController],
  providers: [StoreService, StoreRepository],
})
export class StoreModule {}
