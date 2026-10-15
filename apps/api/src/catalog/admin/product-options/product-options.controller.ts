import { Body, Param, Post, Put, Res } from "@nestjs/common";
import { ApiOperation, ApiParam } from "@nestjs/swagger";
import type { Response } from "express";
import { AdminController } from "../../../auth/admin-controller.decorator.js";
import { ApiProblemResponses, ApiZodBody, ApiZodResponse } from "../../../common/openapi.js";
import { uuidParam, ZodValidationPipe } from "../../../common/zod-validation.pipe.js";
import {
  productDetailResponseSchema,
  type ProductDetailResponse,
} from "../products/products.schemas.js";
import { ProductOptionsService } from "./product-options.service.js";
import {
  addProductOptionValueSchema,
  putProductOptionsSchema,
  type AddProductOptionValueBody,
  type PutProductOptionsBody,
} from "./product-options.schemas.js";

const PRODUCT_PARAM = { name: "id", format: "uuid", description: "Product id." };
const OPTION_PARAM = { name: "optionId", format: "uuid", description: "Option id." };

/** Thin HTTP layer: validate input, call the service, shape the status code. No rules here. */
@AdminController("products")
export class ProductOptionsController {
  constructor(private readonly productOptions: ProductOptionsService) {}

  @Put(":id/options")
  @ApiOperation({
    summary:
      "Replace the options and chosen values of a draft product; the variants are regenerated",
  })
  @ApiParam(PRODUCT_PARAM)
  @ApiZodBody(putProductOptionsSchema)
  @ApiZodResponse(
    200,
    productDetailResponseSchema,
    "The product with its new options and variants.",
  )
  @ApiProblemResponses(400, 404, 409)
  put(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(putProductOptionsSchema)) body: PutProductOptionsBody,
  ): Promise<ProductDetailResponse> {
    return this.productOptions.put(id, body);
  }

  @Post(":id/options/:optionId/values")
  @ApiOperation({
    summary:
      "Add a value to an option of the product (any status) and generate the variants of the new combinations",
  })
  @ApiParam(PRODUCT_PARAM)
  @ApiParam(OPTION_PARAM)
  @ApiZodBody(addProductOptionValueSchema)
  @ApiZodResponse(201, productDetailResponseSchema, "The product with the new value and variants.")
  @ApiProblemResponses(400, 404, 409)
  async addValue(
    @Param("id", uuidParam("id")) id: string,
    @Param("optionId", uuidParam("optionId")) optionId: string,
    @Body(new ZodValidationPipe(addProductOptionValueSchema)) body: AddProductOptionValueBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductDetailResponse> {
    const product = await this.productOptions.addValue(id, optionId, body);
    response.setHeader("Location", `/admin/products/${id}`);
    return product;
  }
}
