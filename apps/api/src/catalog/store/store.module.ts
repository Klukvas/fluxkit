import { Module } from "@nestjs/common";
import { StoreConfigController } from "./store-config.controller.js";
import { StoreCategoriesController } from "./store-categories.controller.js";
import { StoreProductsController } from "./store-products.controller.js";
import { StoreRepository } from "./store.repository.js";
import { StoreService } from "./store.service.js";

/** Public, read-only catalog API under `/store`. No authentication by design. */
@Module({
  controllers: [StoreCategoriesController, StoreConfigController, StoreProductsController],
  providers: [StoreService, StoreRepository],
  // The cart reads the same catalog facts and resolves locales the same way.
  exports: [StoreService, StoreRepository],
})
export class StoreModule {}
