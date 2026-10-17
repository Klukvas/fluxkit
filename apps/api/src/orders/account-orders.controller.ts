import { Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiQuery } from "@nestjs/swagger";
import { z } from "zod";
import { StoreController } from "../catalog/store/store-controller.decorator.js";
import { ApiPaginationQuery, ApiProblemResponses, ApiZodResponse } from "../common/openapi.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { CurrentCustomer } from "../customers/auth/current-customer.js";
import { CustomerAuthenticated } from "../customers/auth/customer-authenticated.decorator.js";
import type { CustomerPrincipal } from "../customers/auth/customer-authenticator.js";
import {
  accountOrdersQuerySchema,
  orderLocaleQuerySchema,
  storeOrderPageSchema,
  storeOrderSchema,
  type AccountOrdersQuery,
  type OrderLocaleQuery,
  type StoreOrder,
  type StoreOrderPage,
} from "./orders.schemas.js";
import { StoreOrdersService } from "./store-orders.service.js";

const LOCALE_QUERY = { name: "locale", required: false, schema: { type: "string" } } as const;
const numberParam = new ZodValidationPipe(z.string().min(1).max(64), "number");

/**
 * Thin HTTP layer of a signed-in customer's own orders (`/store/account/orders`). Every route is
 * `@CustomerAuthenticated()` and acts on the principal the guard produced: the customer id comes from the session,
 * never from the request, and the owner filter is in SQL, so another customer's number is the same 404 as an unknown one.
 */
@StoreController("account/orders")
@CustomerAuthenticated()
export class AccountOrdersController {
  constructor(@Inject(StoreOrdersService) private readonly orders: StoreOrdersService) {}

  @Get()
  @ApiOperation({ summary: "The signed-in customer's orders, newest first" })
  @ApiPaginationQuery()
  @ApiQuery(LOCALE_QUERY)
  @ApiZodResponse(200, storeOrderPageSchema, "A page of order summaries.")
  @ApiProblemResponses(400, 401)
  list(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Query(new ZodValidationPipe(accountOrdersQuerySchema)) query: AccountOrdersQuery,
  ): Promise<StoreOrderPage> {
    return this.orders.listForCustomer(customer.customerId, query);
  }

  @Get(":number")
  @ApiOperation({ summary: "One of the signed-in customer's orders" })
  @ApiParam({ name: "number", description: "The order number, `XXXX-XXXX`." })
  @ApiQuery(LOCALE_QUERY)
  @ApiZodResponse(200, storeOrderSchema, "The order.")
  @ApiProblemResponses(400, 401, 404)
  get(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Param("number", numberParam) number: string,
    @Query(new ZodValidationPipe(orderLocaleQuerySchema)) query: OrderLocaleQuery,
  ): Promise<StoreOrder> {
    return this.orders.getForCustomer(customer.customerId, number, query.locale);
  }

  @Post(":number/cancel")
  @HttpCode(200)
  @ApiOperation({
    summary: "Cancel an own unpaid order",
    description: "Releases the reserved stock. Only while the order is `awaiting_payment`.",
  })
  @ApiParam({ name: "number", description: "The order number, `XXXX-XXXX`." })
  @ApiQuery(LOCALE_QUERY)
  @ApiZodResponse(200, storeOrderSchema, "The cancelled order.")
  @ApiProblemResponses(400, 401, 404, 409)
  cancel(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Param("number", numberParam) number: string,
    @Query(new ZodValidationPipe(orderLocaleQuerySchema)) query: OrderLocaleQuery,
  ): Promise<StoreOrder> {
    return this.orders.cancelAsCustomer(customer.customerId, number, query.locale);
  }
}
