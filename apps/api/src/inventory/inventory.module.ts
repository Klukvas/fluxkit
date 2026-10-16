import { Module } from "@nestjs/common";
import { ProductsModule } from "../catalog/admin/products/products.module.js";
import { InventoryController } from "./admin/inventory.controller.js";
import { InventoryService } from "./admin/inventory.service.js";
import { LocationsController } from "./admin/locations.controller.js";
import { InventoryRepository } from "./inventory.repository.js";

/** Core inventory (no feature flag): the admin stock API now, the reservation domain service next. */
@Module({
  imports: [ProductsModule],
  controllers: [InventoryController, LocationsController],
  providers: [InventoryService, InventoryRepository],
})
export class InventoryModule {}
