import {
  Body,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { ApiNoContentResponse, ApiOperation, ApiParam } from "@nestjs/swagger";
import type { Response } from "express";
import { AdminController } from "../../auth/admin-controller.decorator.js";
import {
  ApiPaginationQuery,
  ApiProblemResponses,
  ApiZodBody,
  ApiZodResponse,
} from "../../common/openapi.js";
import { pageSchema, type Page, type PaginationQuery } from "../../common/pagination.js";
import { uuidParam, ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SHIPPING_ADMIN_PERMISSIONS } from "./shipping-admin-permissions.js";
import {
  createShippingMethodSchema,
  listShippingMethodsQuerySchema,
  shippingMethodResponseSchema,
  updateShippingMethodSchema,
  type CreateShippingMethodBody,
  type ShippingMethodResponse,
  type UpdateShippingMethodBody,
} from "./shipping-methods.schemas.js";
import { ShippingMethodsService } from "./shipping-methods.service.js";

const ID_PARAM = { name: "id", format: "uuid", description: "Shipping method id." };

/**
 * Thin HTTP layer of the shipping methods. Every route needs `shipping.manage` (reads included: rates are shop
 * configuration), declared once as the default pair of the controller; a route added later is protected the same way.
 */
@AdminController("shipping", SHIPPING_ADMIN_PERMISSIONS)
export class ShippingMethodsController {
  constructor(@Inject(ShippingMethodsService) private readonly methods: ShippingMethodsService) {}

  @Post("methods")
  @ApiOperation({
    summary: "Create a shipping method",
    description:
      "The method is inactive unless `isActive` is true. The currency is the shop currency. A `pickup_point` method needs an enabled provider.",
  })
  @ApiZodBody(createShippingMethodSchema)
  @ApiZodResponse(201, shippingMethodResponseSchema, "The created method. `Location` points to it.")
  @ApiProblemResponses(400, 409)
  async create(
    @Body(new ZodValidationPipe(createShippingMethodSchema)) body: CreateShippingMethodBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ShippingMethodResponse> {
    const created = await this.methods.create(body);
    response.setHeader("Location", `/admin/shipping/methods/${created.id}`);
    return created;
  }

  @Get("methods")
  @ApiOperation({ summary: "List shipping methods, ordered by position and code" })
  @ApiPaginationQuery()
  @ApiZodResponse(200, pageSchema(shippingMethodResponseSchema), "A page of methods.")
  @ApiProblemResponses(400)
  list(
    @Query(new ZodValidationPipe(listShippingMethodsQuerySchema)) query: PaginationQuery,
  ): Promise<Page<ShippingMethodResponse>> {
    return this.methods.list(query);
  }

  @Get("methods/:id")
  @ApiOperation({ summary: "Get a shipping method" })
  @ApiParam(ID_PARAM)
  @ApiZodResponse(200, shippingMethodResponseSchema, "The method.")
  @ApiProblemResponses(400, 404)
  get(@Param("id", uuidParam("id")) id: string): Promise<ShippingMethodResponse> {
    return this.methods.get(id);
  }

  @Patch("methods/:id")
  @ApiOperation({
    summary: "Change a shipping method (only the listed fields)",
    description:
      "The code never changes. A `pricing` in the body replaces the whole pricing and stamps the shop currency. Deactivating always works, whatever the provider's state.",
  })
  @ApiParam(ID_PARAM)
  @ApiZodBody(updateShippingMethodSchema)
  @ApiZodResponse(200, shippingMethodResponseSchema, "The updated method.")
  @ApiProblemResponses(400, 404, 409)
  update(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(updateShippingMethodSchema)) body: UpdateShippingMethodBody,
  ): Promise<ShippingMethodResponse> {
    return this.methods.update(id, body);
  }

  @Delete("methods/:id")
  @HttpCode(204)
  @ApiOperation({
    summary: "Delete a shipping method that no order used",
    description:
      "A method that an order's shipping snapshot links answers 409 `rule_violation` (`rule: method_in_use`): deactivate it instead.",
  })
  @ApiParam(ID_PARAM)
  @ApiNoContentResponse({ description: "Deleted." })
  @ApiProblemResponses(400, 404, 409)
  delete(@Param("id", uuidParam("id")) id: string): Promise<void> {
    return this.methods.delete(id);
  }
}
