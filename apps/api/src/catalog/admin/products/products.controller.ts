import { Body, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res } from "@nestjs/common";
import { ApiNoContentResponse, ApiOperation, ApiParam, ApiQuery } from "@nestjs/swagger";
import type { Response } from "express";
import { AdminController } from "../../../auth/admin-controller.decorator.js";
import { RequirePermission } from "../../../auth/route-access.js";
import {
  ApiPaginationQuery,
  ApiProblemResponses,
  ApiZodBody,
  ApiZodResponse,
} from "../../../common/openapi.js";
import { pageSchema, type Page } from "../../../common/pagination.js";
import { uuidParam, ZodValidationPipe } from "../../../common/zod-validation.pipe.js";
import { ProductsService } from "./products.service.js";
import {
  PRODUCT_STATUSES,
  createProductSchema,
  listProductsQuerySchema,
  productDetailResponseSchema,
  productResponseSchema,
  putProductCategoriesSchema,
  putProductMediaSchema,
  updateProductSchema,
  type CreateProductBody,
  type ListProductsQuery,
  type ProductDetailResponse,
  type ProductResponse,
  type PutProductCategoriesBody,
  type PutProductMediaBody,
  type UpdateProductBody,
} from "./products.schemas.js";

const ID_PARAM = { name: "id", format: "uuid", description: "Product id." };

/** Thin HTTP layer: validate input, call the service, shape the status code. No rules here. */
@AdminController("products")
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post()
  @ApiOperation({
    summary: "Create a draft product of a product type, with its single default variant",
  })
  @ApiZodBody(createProductSchema)
  @ApiZodResponse(201, productDetailResponseSchema, "The created product. `Location` points to it.")
  @ApiProblemResponses(400, 409)
  async create(
    @Body(new ZodValidationPipe(createProductSchema)) body: CreateProductBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductDetailResponse> {
    const created = await this.products.create(body);
    response.setHeader("Location", `/admin/products/${created.id}`);
    return created;
  }

  @Get()
  @ApiOperation({ summary: "List products, ordered by slug; filter by status, category or brand" })
  @ApiPaginationQuery()
  @ApiQuery({ name: "status", required: false, enum: PRODUCT_STATUSES })
  @ApiQuery({ name: "categoryId", required: false, schema: { type: "string", format: "uuid" } })
  @ApiQuery({ name: "brandId", required: false, schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, pageSchema(productResponseSchema), "A page of products.")
  @ApiProblemResponses(400)
  list(
    @Query(new ZodValidationPipe(listProductsQuerySchema)) query: ListProductsQuery,
  ): Promise<Page<ProductResponse>> {
    return this.products.list(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a product with its categories, media, variants and options" })
  @ApiParam(ID_PARAM)
  @ApiZodResponse(200, productDetailResponseSchema, "The product.")
  @ApiProblemResponses(400, 404)
  get(@Param("id", uuidParam("id")) id: string): Promise<ProductDetailResponse> {
    return this.products.get(id);
  }

  @Patch(":id")
  @ApiOperation({
    summary:
      "Change a product (only the listed fields; the status changes via the lifecycle routes)",
  })
  @ApiParam(ID_PARAM)
  @ApiZodBody(updateProductSchema)
  @ApiZodResponse(200, productDetailResponseSchema, "The updated product.")
  @ApiProblemResponses(400, 404, 409)
  update(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(updateProductSchema)) body: UpdateProductBody,
  ): Promise<ProductDetailResponse> {
    return this.products.update(id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a product that was never published (archive the others)" })
  @ApiParam(ID_PARAM)
  @ApiNoContentResponse({
    description: "Deleted, with its variants, options, categories and media.",
  })
  @ApiProblemResponses(400, 404, 409)
  delete(@Param("id", uuidParam("id")) id: string): Promise<void> {
    return this.products.delete(id);
  }

  @Post(":id/publish")
  @RequirePermission("catalog.publish")
  @HttpCode(200)
  @ApiOperation({
    summary: "Publish a draft product (draft to active); every publish precondition is checked",
  })
  @ApiParam(ID_PARAM)
  @ApiZodResponse(200, productDetailResponseSchema, "The published product.")
  @ApiProblemResponses(400, 404, 409)
  publish(@Param("id", uuidParam("id")) id: string): Promise<ProductDetailResponse> {
    return this.products.transition(id, "publish");
  }

  @Post(":id/unpublish")
  @RequirePermission("catalog.publish")
  @HttpCode(200)
  @ApiOperation({ summary: "Take an active product back to draft" })
  @ApiParam(ID_PARAM)
  @ApiZodResponse(200, productDetailResponseSchema, "The draft product.")
  @ApiProblemResponses(400, 404, 409)
  unpublish(@Param("id", uuidParam("id")) id: string): Promise<ProductDetailResponse> {
    return this.products.transition(id, "unpublish");
  }

  @Post(":id/archive")
  @RequirePermission("catalog.publish")
  @HttpCode(200)
  @ApiOperation({ summary: "Archive a draft or active product (soft delete)" })
  @ApiParam(ID_PARAM)
  @ApiZodResponse(200, productDetailResponseSchema, "The archived product.")
  @ApiProblemResponses(400, 404, 409)
  archive(@Param("id", uuidParam("id")) id: string): Promise<ProductDetailResponse> {
    return this.products.transition(id, "archive");
  }

  @Post(":id/restore")
  @RequirePermission("catalog.publish")
  @HttpCode(200)
  @ApiOperation({ summary: "Restore an archived product as a draft (publish again to go live)" })
  @ApiParam(ID_PARAM)
  @ApiZodResponse(200, productDetailResponseSchema, "The draft product.")
  @ApiProblemResponses(400, 404, 409)
  restore(@Param("id", uuidParam("id")) id: string): Promise<ProductDetailResponse> {
    return this.products.transition(id, "restore");
  }

  @Put(":id/categories")
  @ApiOperation({
    summary: "Replace the categories of a product; exactly one assignment is primary",
  })
  @ApiParam(ID_PARAM)
  @ApiZodBody(putProductCategoriesSchema)
  @ApiZodResponse(200, productDetailResponseSchema, "The product with its new categories.")
  @ApiProblemResponses(400, 404)
  putCategories(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(putProductCategoriesSchema)) body: PutProductCategoriesBody,
  ): Promise<ProductDetailResponse> {
    return this.products.putCategories(id, body);
  }

  @Put(":id/media")
  @ApiOperation({ summary: "Replace the media list of a product" })
  @ApiParam(ID_PARAM)
  @ApiZodBody(putProductMediaSchema)
  @ApiZodResponse(200, productDetailResponseSchema, "The product with its new media.")
  @ApiProblemResponses(400, 404)
  putMedia(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(putProductMediaSchema)) body: PutProductMediaBody,
  ): Promise<ProductDetailResponse> {
    return this.products.putMedia(id, body);
  }
}
