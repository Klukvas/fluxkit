import { Module } from "@nestjs/common";
import { ProductsModule } from "../catalog/admin/products/products.module.js";
import { InventoryController } from "./admin/inventory.controller.js";
import { InventoryService } from "./admin/inventory.service.js";
import { LocationsController } from "./admin/locations.controller.js";
import { InventoryRepository } from "./inventory.repository.js";
import { ReservationsRepository } from "./reservations/reservations.repository.js";
import { ReservationsService } from "./reservations/reservations.service.js";

/**
 * Core inventory (no feature flag): the admin stock API and the reservation domain service. `ReservationsService`
 * has no HTTP route and is exported for the checkout module.
 */
@Module({
  imports: [ProductsModule],
  controllers: [InventoryController, LocationsController],
  providers: [InventoryService, InventoryRepository, ReservationsService, ReservationsRepository],
  exports: [ReservationsService],
})
export class InventoryModule {}
