import { Body, Delete, Get, HttpCode, Param, Put, Res } from "@nestjs/common";
import { ApiNoContentResponse, ApiOperation, ApiParam } from "@nestjs/swagger";
import type { Response } from "express";
import { AdminController } from "../../../auth/admin-controller.decorator.js";
import { ApiProblemResponses, ApiZodBody, ApiZodResponse } from "../../../common/openapi.js";
import { uuidParam, ZodValidationPipe } from "../../../common/zod-validation.pipe.js";
import { PricesService } from "./prices.service.js";
import {
  currencyParam,
  priceListResponseSchema,
  priceResponseSchema,
  putPriceSchema,
  putProductPricesSchema,
  type PriceListResponse,
  type PriceResponse,
  type PutPriceBody,
  type PutProductPricesBody,
} from "./prices.schemas.js";

const PRODUCT_PARAM = { name: "id", format: "uuid", description: "Product id." };
const VARIANT_PARAM = { name: "variantId", format: "uuid", description: "Variant id." };
const CURRENCY_PARAM = {
  name: "currency",
  description: "Upper-case ISO 4217 code of a supported currency, for example UAH.",
};

/** Thin HTTP layer: validate input, call the service, shape the status code. No rules here. */
@AdminController("products")
export class PricesController {
  constructor(private readonly prices: PricesService) {}

  @Get(":id/variants/:variantId/prices")
  @ApiOperation({ summary: "List the prices of a variant, ordered by currency" })
  @ApiParam(PRODUCT_PARAM)
  @ApiParam(VARIANT_PARAM)
  @ApiZodResponse(200, priceListResponseSchema, "The prices (one per currency, possibly none).")
  @ApiProblemResponses(400, 404)
  list(
    @Param("id", uuidParam("id")) id: string,
    @Param("variantId", uuidParam("variantId")) variantId: string,
  ): Promise<PriceListResponse> {
    return this.prices.list(id, variantId);
  }

  @Get(":id/prices")
  @ApiOperation({
    summary: "List the prices of every variant of a product, in every currency",
    description:
      "Variant order (position, then id), then currency; each item is the shape of the per-variant list, `variantId` included. Not paged: a product has at most 250 variants.",
  })
  @ApiParam(PRODUCT_PARAM)
  @ApiZodResponse(200, priceListResponseSchema, "The prices (possibly none).")
  @ApiProblemResponses(400, 404)
  listOfProduct(@Param("id", uuidParam("id")) id: string): Promise<PriceListResponse> {
    return this.prices.listOfProduct(id);
  }

  @Put(":id/variants/:variantId/prices/:currency")
  @ApiOperation({
    summary: "Set the price of a variant in one currency (creates it or replaces it entirely)",
    description:
      "Answers 201 when the price is new and 200 when it replaced one. `compareAtAmount` null or absent clears the old price. Only the shop currency is ever sold.",
  })
  @ApiParam(PRODUCT_PARAM)
  @ApiParam(VARIANT_PARAM)
  @ApiParam(CURRENCY_PARAM)
  @ApiZodBody(putPriceSchema)
  @ApiZodResponse(200, priceResponseSchema, "The replaced price.")
  @ApiZodResponse(201, priceResponseSchema, "The new price.")
  @ApiProblemResponses(400, 404)
  async put(
    @Param("id", uuidParam("id")) id: string,
    @Param("variantId", uuidParam("variantId")) variantId: string,
    @Param("currency", currencyParam()) currency: string,
    @Body(new ZodValidationPipe(putPriceSchema)) body: PutPriceBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PriceResponse> {
    const { price, created } = await this.prices.put(id, variantId, currency, body);
    response.status(created ? 201 : 200);
    return price;
  }

  @Delete(":id/variants/:variantId/prices/:currency")
  @HttpCode(204)
  @ApiOperation({
    summary: "Delete the price of a variant in one currency",
    description:
      "Refused with 409 `rule_violation` (rule `last_shop_price`) for the shop-currency price of an active variant of a published product.",
  })
  @ApiParam(PRODUCT_PARAM)
  @ApiParam(VARIANT_PARAM)
  @ApiParam(CURRENCY_PARAM)
  @ApiNoContentResponse({ description: "Deleted." })
  @ApiProblemResponses(400, 404, 409)
  delete(
    @Param("id", uuidParam("id")) id: string,
    @Param("variantId", uuidParam("variantId")) variantId: string,
    @Param("currency", currencyParam()) currency: string,
  ): Promise<void> {
    return this.prices.delete(id, variantId, currency);
  }

  @Put(":id/prices")
  @ApiOperation({
    summary: "Set many prices of one product's variants in one transaction (all or nothing)",
    description:
      "At most 500 items. Every item is validated; errors carry indexed paths (`items.3.amount`). A variant of another product, or the same variant and currency twice, is rejected.",
  })
  @ApiParam(PRODUCT_PARAM)
  @ApiZodBody(putProductPricesSchema)
  @ApiZodResponse(200, priceListResponseSchema, "The written prices, in request order.")
  @ApiProblemResponses(400, 404)
  putMany(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(putProductPricesSchema)) body: PutProductPricesBody,
  ): Promise<PriceListResponse> {
    return this.prices.putMany(id, body);
  }
}
