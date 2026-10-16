import { Get } from "@nestjs/common";
import { ApiOperation } from "@nestjs/swagger";
import { AdminController } from "../../auth/admin-controller.decorator.js";
import { ApiZodResponse } from "../../common/openapi.js";
import { InventoryService } from "./inventory.service.js";
import { locationListResponseSchema, type LocationListResponse } from "./locations.schemas.js";

/** Read-only for now: the migration creates the default location `main`; managing locations needs its own plan. */
@AdminController("locations")
export class LocationsController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @ApiOperation({ summary: "List the stock locations, ordered by code" })
  @ApiZodResponse(200, locationListResponseSchema, "The locations; exactly one is the default.")
  list(): Promise<LocationListResponse> {
    return this.inventory.listLocations();
  }
}
