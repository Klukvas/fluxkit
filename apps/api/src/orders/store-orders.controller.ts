import { Body, HttpCode, Inject, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiQuery } from "@nestjs/swagger";
import { StoreController } from "../catalog/store/store-controller.decorator.js";
import { ApiProblemResponses, ApiZodBody, ApiZodResponse } from "../common/openapi.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { RateLimit } from "../rate-limit/rate-limit.decorator.js";
import {
  guestOrderBodySchema,
  orderLocaleQuerySchema,
  storeOrderSchema,
  type GuestOrderBody,
  type OrderLocaleQuery,
  type StoreOrder,
} from "./orders.schemas.js";
import { StoreOrdersService } from "./store-orders.service.js";

const LOCALE_QUERY = { name: "locale", required: false, schema: { type: "string" } } as const;

/**
 * Thin HTTP layer of the guest order routes (`/store/orders/*`). A guest has no account: the number plus the access
 * token that placement returned open one order. Both are POSTs, so the token is never in a URL or an access log. Every
 * failure of the token is the same 404. Limited per address (`orderLookup`, `guestCancel`); responses are `no-store`.
 */
@StoreController("orders")
export class StoreOrdersController {
  constructor(@Inject(StoreOrdersService) private readonly orders: StoreOrdersService) {}

  @Post("lookup")
  @RateLimit("orderLookup")
  @HttpCode(200)
  @ApiOperation({
    summary: "Read a guest order with its access token",
    description:
      "404 for an unknown number, a wrong or expired token and an order of a signed-in customer alike.",
  })
  @ApiQuery(LOCALE_QUERY)
  @ApiZodBody(guestOrderBodySchema)
  @ApiZodResponse(200, storeOrderSchema, "The order.")
  @ApiProblemResponses(400, 404, 429)
  lookup(
    @Body(new ZodValidationPipe(guestOrderBodySchema)) body: GuestOrderBody,
    @Query(new ZodValidationPipe(orderLocaleQuerySchema)) query: OrderLocaleQuery,
  ): Promise<StoreOrder> {
    return this.orders.lookupAsGuest(body.number, body.accessToken, query.locale);
  }

  @Post("cancel")
  @RateLimit("guestCancel")
  @HttpCode(200)
  @ApiOperation({
    summary: "Cancel an unpaid guest order",
    description:
      "Releases the reserved stock. Only while the order is `awaiting_payment`; 404 as for the lookup.",
  })
  @ApiQuery(LOCALE_QUERY)
  @ApiZodBody(guestOrderBodySchema)
  @ApiZodResponse(200, storeOrderSchema, "The cancelled order.")
  @ApiProblemResponses(400, 404, 409, 429)
  cancel(
    @Body(new ZodValidationPipe(guestOrderBodySchema)) body: GuestOrderBody,
    @Query(new ZodValidationPipe(orderLocaleQuerySchema)) query: OrderLocaleQuery,
  ): Promise<StoreOrder> {
    return this.orders.cancelAsGuest(body.number, body.accessToken, query.locale);
  }
}
