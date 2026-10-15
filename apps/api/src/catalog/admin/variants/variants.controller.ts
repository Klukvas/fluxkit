import { Body, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from "@nestjs/common";
import { ApiNoContentResponse, ApiOperation, ApiParam } from "@nestjs/swagger";
import type { Response } from "express";
import { AdminController } from "../../../auth/admin-controller.decorator.js";
import {
  ApiPaginationQuery,
  ApiProblemResponses,
  ApiZodBody,
  ApiZodResponse,
} from "../../../common/openapi.js";
import { pageSchema, type Page } from "../../../common/pagination.js";
import { uuidParam, ZodValidationPipe } from "../../../common/zod-validation.pipe.js";
import { VariantsService } from "./variants.service.js";
import {
  createVariantSchema,
  generateVariantsResponseSchema,
  listVariantsQuerySchema,
  updateVariantSchema,
  variantResponseSchema,
  type CreateVariantBody,
  type GenerateVariantsResponse,
  type ListVariantsQuery,
  type UpdateVariantBody,
  type VariantResponse,
} from "./variants.schemas.js";

const PRODUCT_PARAM = { name: "id", format: "uuid", description: "Product id." };
const VARIANT_PARAM = { name: "variantId", format: "uuid", description: "Variant id." };

/** Thin HTTP layer: validate input, call the service, shape the status code. No rules here. */
@AdminController("products")
export class VariantsController {
  constructor(private readonly variants: VariantsService) {}

  @Get(":id/variants")
  @ApiOperation({ summary: "List the variants of a product, ordered by position" })
  @ApiParam(PRODUCT_PARAM)
  @ApiPaginationQuery()
  @ApiZodResponse(200, pageSchema(variantResponseSchema), "A page of variants.")
  @ApiProblemResponses(400, 404)
  list(
    @Param("id", uuidParam("id")) id: string,
    @Query(new ZodValidationPipe(listVariantsQuerySchema)) query: ListVariantsQuery,
  ): Promise<Page<VariantResponse>> {
    return this.variants.list(id, query);
  }

  @Post(":id/variants")
  @ApiOperation({
    summary:
      "Create one variant of a draft product from one value of every product option (usually generate is easier)",
  })
  @ApiParam(PRODUCT_PARAM)
  @ApiZodBody(createVariantSchema)
  @ApiZodResponse(201, variantResponseSchema, "The created variant. `Location` points to it.")
  @ApiProblemResponses(400, 404, 409)
  async create(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(createVariantSchema)) body: CreateVariantBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<VariantResponse> {
    const created = await this.variants.create(id, body);
    response.setHeader("Location", `/admin/products/${id}/variants/${created.id}`);
    return created;
  }

  @Post(":id/variants/generate")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Create the variants missing for the product's current options (idempotent); the first one of a product without variants becomes the default",
  })
  @ApiParam(PRODUCT_PARAM)
  @ApiZodResponse(200, generateVariantsResponseSchema, "Counts and the product's variants.")
  @ApiProblemResponses(400, 404)
  generate(@Param("id", uuidParam("id")) id: string): Promise<GenerateVariantsResponse> {
    return this.variants.generate(id);
  }

  @Get(":id/variants/:variantId")
  @ApiOperation({ summary: "Get one variant with its option values" })
  @ApiParam(PRODUCT_PARAM)
  @ApiParam(VARIANT_PARAM)
  @ApiZodResponse(200, variantResponseSchema, "The variant.")
  @ApiProblemResponses(400, 404)
  get(
    @Param("id", uuidParam("id")) id: string,
    @Param("variantId", uuidParam("variantId")) variantId: string,
  ): Promise<VariantResponse> {
    return this.variants.get(id, variantId);
  }

  @Patch(":id/variants/:variantId")
  @ApiOperation({
    summary:
      "Change a variant (only the listed fields; option values are immutable); isDefault true moves the default flag",
  })
  @ApiParam(PRODUCT_PARAM)
  @ApiParam(VARIANT_PARAM)
  @ApiZodBody(updateVariantSchema)
  @ApiZodResponse(200, variantResponseSchema, "The updated variant.")
  @ApiProblemResponses(400, 404, 409)
  update(
    @Param("id", uuidParam("id")) id: string,
    @Param("variantId", uuidParam("variantId")) variantId: string,
    @Body(new ZodValidationPipe(updateVariantSchema)) body: UpdateVariantBody,
  ): Promise<VariantResponse> {
    return this.variants.update(id, variantId, body);
  }

  @Delete(":id/variants/:variantId")
  @HttpCode(204)
  @ApiOperation({
    summary: "Delete a variant of a draft product (never the last or the default one)",
  })
  @ApiParam(PRODUCT_PARAM)
  @ApiParam(VARIANT_PARAM)
  @ApiNoContentResponse({ description: "Deleted." })
  @ApiProblemResponses(400, 404, 409)
  delete(
    @Param("id", uuidParam("id")) id: string,
    @Param("variantId", uuidParam("variantId")) variantId: string,
  ): Promise<void> {
    return this.variants.delete(id, variantId);
  }
}
