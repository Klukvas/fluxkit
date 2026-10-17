import { Body, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiQuery } from "@nestjs/swagger";
import { ORDER_STATUSES } from "@fluxkit/core";
import { type AdminPrincipal } from "../../auth/admin-authenticator.js";
import { AdminController } from "../../auth/admin-controller.decorator.js";
import { CurrentAdmin } from "../../auth/current-admin.js";
import { ApiProblemResponses, ApiZodBody, ApiZodResponse } from "../../common/openapi.js";
import { pageSchema, type Page } from "../../common/pagination.js";
import { uuidParam, ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import {
  adminOrderSchema,
  adminOrderSummarySchema,
  cancelOrderSchema,
  listAdminOrdersQuerySchema,
  markPaidSchema,
  ADMIN_ORDERS_DEFAULT_PAGE_SIZE,
  type AdminOrderDetail,
  type AdminOrderSummary,
  type CancelOrderBody,
  type ListAdminOrdersQuery,
  type MarkPaidBody,
} from "./admin-orders.schemas.js";
import { AdminOrdersService } from "./admin-orders.service.js";

const ID_PARAM = { name: "id", format: "uuid", description: "Order id." };

/**
 * Thin HTTP layer of order management. The default pair names the order permissions: GET needs `orders.read`, every
 * POST needs `orders.write` (a route added later is protected the same way). The viewer holds neither (personal data),
 * manager and owner hold both. The acting admin is read from the session, never from the request.
 */
@AdminController("orders", { read: "orders.read", write: "orders.write" })
export class AdminOrdersController {
  constructor(@Inject(AdminOrdersService) private readonly orders: AdminOrdersService) {}

  @Get()
  @ApiOperation({
    summary: "List orders, newest first",
    description:
      "Summaries only (no addresses). `placedFrom` is inclusive, `placedTo` exclusive. `q` is an order number (the way a person types it) or an exact email; nothing matches by prefix.",
  })
  @ApiQuery({
    name: "limit",
    required: false,
    schema: { type: "integer", minimum: 1, maximum: 100, default: ADMIN_ORDERS_DEFAULT_PAGE_SIZE },
  })
  @ApiQuery({
    name: "offset",
    required: false,
    schema: { type: "integer", minimum: 0, maximum: 10000, default: 0 },
  })
  @ApiQuery({
    name: "status",
    required: false,
    schema: { type: "string", enum: [...ORDER_STATUSES] },
  })
  @ApiQuery({
    name: "placedFrom",
    required: false,
    description: "ISO 8601 instant with Z or an offset, inclusive.",
    schema: { type: "string", format: "date-time" },
  })
  @ApiQuery({
    name: "placedTo",
    required: false,
    description: "ISO 8601 instant with Z or an offset, exclusive; not before placedFrom.",
    schema: { type: "string", format: "date-time" },
  })
  @ApiQuery({
    name: "q",
    required: false,
    description: "An order number (case, dash and look-alike letters forgiven) or an exact email.",
    schema: { type: "string", maxLength: 254 },
  })
  @ApiZodResponse(200, pageSchema(adminOrderSummarySchema), "A page of order summaries.")
  @ApiProblemResponses(400)
  list(
    @Query(new ZodValidationPipe(listAdminOrdersQuerySchema)) query: ListAdminOrdersQuery,
  ): Promise<Page<AdminOrderSummary>> {
    return this.orders.list(query);
  }

  @Get(":id")
  @ApiOperation({
    summary: "Get one order in full",
    description:
      "Contact, addresses, the item snapshot with every locale, totals, the status journal with its actors, and the status and quantity of each line's reservations. Never a token, an idempotency key or a request fingerprint.",
  })
  @ApiParam(ID_PARAM)
  @ApiZodResponse(200, adminOrderSchema, "The order.")
  @ApiProblemResponses(400, 404)
  get(@Param("id", uuidParam("id")) id: string): Promise<AdminOrderDetail> {
    return this.orders.get(id);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @ApiOperation({
    summary: "Cancel an order that awaits payment or is paid",
    description:
      "An unpaid order gives its reserved stock back. A paid order is cancelled with its sold units staying sold: nothing is restocked and nothing is refunded (do both by hand).",
  })
  @ApiParam(ID_PARAM)
  @ApiZodBody(cancelOrderSchema)
  @ApiZodResponse(200, adminOrderSchema, "The cancelled order.")
  @ApiProblemResponses(400, 404, 409)
  cancel(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(cancelOrderSchema)) body: CancelOrderBody,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminOrderDetail> {
    return this.orders.cancel(id, admin.userId, body);
  }

  @Post(":id/mark-paid")
  @HttpCode(200)
  @ApiOperation({
    summary: "Record a payment received outside the system",
    description:
      "The same entry point a payment plugin uses. The amount must equal the order total. Repeating the same reference answers 200 with the order unchanged.",
  })
  @ApiParam(ID_PARAM)
  @ApiZodBody(markPaidSchema)
  @ApiZodResponse(200, adminOrderSchema, "The paid order.")
  @ApiProblemResponses(400, 404, 409)
  markPaid(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(markPaidSchema)) body: MarkPaidBody,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminOrderDetail> {
    return this.orders.markPaid(id, admin.userId, body);
  }

  @Post(":id/mark-fulfilled")
  @HttpCode(200)
  @ApiOperation({
    summary: "Mark a paid order fulfilled",
    description:
      "Commits the reservations still held (backordered lines) or refuses with `awaiting_stock` and changes nothing.",
  })
  @ApiParam(ID_PARAM)
  @ApiZodResponse(200, adminOrderSchema, "The fulfilled order.")
  @ApiProblemResponses(400, 404, 409)
  markFulfilled(
    @Param("id", uuidParam("id")) id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminOrderDetail> {
    return this.orders.markFulfilled(id, admin.userId);
  }
}
