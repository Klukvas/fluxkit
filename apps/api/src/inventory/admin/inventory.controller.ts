import { Body, Get, Param, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiQuery } from "@nestjs/swagger";
import { AdminController } from "../../auth/admin-controller.decorator.js";
import { RequirePermission } from "../../auth/route-access.js";
import type { AdminPrincipal } from "../../auth/admin-authenticator.js";
import { CurrentAdmin } from "../../auth/current-admin.js";
import {
  ApiPaginationQuery,
  ApiProblemResponses,
  ApiZodBody,
  ApiZodResponse,
} from "../../common/openapi.js";
import type { Page } from "../../common/pagination.js";
import { uuidParam, ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { InventoryService } from "./inventory.service.js";
import {
  adjustmentResponseSchema,
  adjustmentSchema,
  inventoryResponseSchema,
  listMovementsQuerySchema,
  listReservationsQuerySchema,
  movementPageSchema,
  productInventoryResponseSchema,
  RESERVATION_STATUSES,
  reservationPageSchema,
  type AdjustmentBody,
  type AdjustmentResponse,
  type InventoryResponse,
  type ListMovementsQuery,
  type ListReservationsQuery,
  type MovementResponse,
  type ProductInventoryResponse,
  type ReservationListItem,
} from "./inventory.schemas.js";

const PRODUCT_PARAM = { name: "id", format: "uuid", description: "Product id." };
const VARIANT_PARAM = { name: "variantId", format: "uuid", description: "Variant id." };

/** Thin HTTP layer: validate input, call the service, shape the status code. No rules here. */
@AdminController("products")
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get(":id/inventory")
  @ApiOperation({
    summary: "Get the stock flags and levels of every variant of a product (admin only)",
    description:
      "One entry per variant in variant order, each exactly the shape of the per-variant read (`levels` per location, `totalAvailable`). Not paged: a product has at most 250 variants. Reads create nothing.",
  })
  @ApiParam(PRODUCT_PARAM)
  @ApiZodResponse(200, productInventoryResponseSchema, "The inventory of every variant.")
  @ApiProblemResponses(400, 404)
  getOfProduct(@Param("id", uuidParam("id")) id: string): Promise<ProductInventoryResponse> {
    return this.inventory.getOfProduct(id);
  }

  @Get(":id/variants/:variantId/inventory")
  @ApiOperation({
    summary: "Get the stock flags and the levels of a variant per location (admin only)",
    description:
      "Reads create nothing: a variant without level rows has an empty `levels` list and `totalAvailable` 0.",
  })
  @ApiParam(PRODUCT_PARAM)
  @ApiParam(VARIANT_PARAM)
  @ApiZodResponse(200, inventoryResponseSchema, "The flags, the levels and the total available.")
  @ApiProblemResponses(400, 404)
  get(
    @Param("id", uuidParam("id")) id: string,
    @Param("variantId", uuidParam("variantId")) variantId: string,
  ): Promise<InventoryResponse> {
    return this.inventory.get(id, variantId);
  }

  @Post(":id/variants/:variantId/inventory/adjustments")
  @ApiOperation({
    summary:
      "Receive, count or return stock: change on hand by a delta or set it, with a journal row",
    description:
      "Locks the level row, applies the core stock rules and appends a `stock_movement` row with the acting admin, in one transaction. The level is created by the first accepted change. Refusals: 400 `validation_failed` for an unusable number (`invalid_quantity`, `on_hand_out_of_range`), 409 `rule_violation` with the core reason (`negative_on_hand`, `below_reserved`, `no_change`, `kind_requires_increase`).",
  })
  @ApiParam(PRODUCT_PARAM)
  @ApiParam(VARIANT_PARAM)
  @ApiZodBody(adjustmentSchema)
  @ApiZodResponse(201, adjustmentResponseSchema, "The new level and the journal row.")
  @ApiProblemResponses(400, 404, 409)
  adjust(
    @Param("id", uuidParam("id")) id: string,
    @Param("variantId", uuidParam("variantId")) variantId: string,
    @Body(new ZodValidationPipe(adjustmentSchema)) body: AdjustmentBody,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdjustmentResponse> {
    return this.inventory.adjust(id, variantId, body, admin.userId);
  }

  @Get(":id/variants/:variantId/inventory/movements")
  @ApiOperation({ summary: "List the stock journal of a variant, newest first" })
  @ApiParam(PRODUCT_PARAM)
  @ApiParam(VARIANT_PARAM)
  @ApiPaginationQuery()
  @ApiZodResponse(200, movementPageSchema, "A page of journal rows.")
  @ApiProblemResponses(400, 404)
  listMovements(
    @Param("id", uuidParam("id")) id: string,
    @Param("variantId", uuidParam("variantId")) variantId: string,
    @Query(new ZodValidationPipe(listMovementsQuerySchema)) query: ListMovementsQuery,
  ): Promise<Page<MovementResponse>> {
    return this.inventory.listMovements(id, variantId, query);
  }

  @Get(":id/variants/:variantId/inventory/reservations")
  @RequirePermission("orders.read")
  @ApiOperation({
    summary: "List the reservations of a variant in one status, newest first (needs orders.read)",
    description:
      "`status` defaults to `active`, the units held now. Each item links the order that holds it (`orderId`, `reference` = the order number); both are null for a hold no order owns. Needs `orders.read`, not `catalog.read`, because it links orders. Nothing about the buyer is returned.",
  })
  @ApiParam(PRODUCT_PARAM)
  @ApiParam(VARIANT_PARAM)
  @ApiPaginationQuery()
  @ApiQuery({
    name: "status",
    required: false,
    schema: { type: "string", enum: [...RESERVATION_STATUSES], default: "active" },
  })
  @ApiZodResponse(200, reservationPageSchema, "A page of reservations.")
  @ApiProblemResponses(400, 404)
  listReservations(
    @Param("id", uuidParam("id")) id: string,
    @Param("variantId", uuidParam("variantId")) variantId: string,
    @Query(new ZodValidationPipe(listReservationsQuerySchema)) query: ListReservationsQuery,
  ): Promise<Page<ReservationListItem>> {
    return this.inventory.listReservations(id, variantId, query);
  }
}
