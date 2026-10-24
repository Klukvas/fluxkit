import { Module } from "@nestjs/common";
import { ShipmentChanges } from "./shipment-changes.js";
import { ShipmentTrackingService } from "./shipment-tracking.service.js";
import { ShipmentsController } from "./shipments.controller.js";
import { ShipmentsRepository } from "./shipments.repository.js";
import { ShipmentsService } from "./shipments.service.js";

/**
 * Shipments (ADR 0029 decision 10, plan step 8): the shipment routes under `/admin/orders/{id}/shipments` and the
 * tracking service the scheduler's job 8 uses (`JobsModule` imports this module). Core, no flag: without a carrier
 * provider no order can have a shipment, and the job polls nobody. Needs the globals of `ShippingRegistryModule` (the
 * registry and `SHIPMENT_CALL_TIMEOUTS`), `OrdersModule` (`OrdersService`, `OrdersRepository`), `AuthModule` (clock)
 * and the database. Never moves an order: fulfilment stays an admin action.
 */
@Module({
  controllers: [ShipmentsController],
  providers: [ShipmentsRepository, ShipmentChanges, ShipmentTrackingService, ShipmentsService],
  exports: [ShipmentTrackingService],
})
export class ShipmentsModule {}
