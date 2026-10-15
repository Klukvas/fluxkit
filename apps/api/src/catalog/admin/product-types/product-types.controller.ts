import { Body, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res } from "@nestjs/common";
import { ApiNoContentResponse, ApiOperation, ApiParam } from "@nestjs/swagger";
import type { Response } from "express";
import { AdminController } from "../../../auth/admin-controller.decorator.js";
import {
  ApiPaginationQuery,
  ApiProblemResponses,
  ApiZodBody,
  ApiZodResponse,
} from "../../../common/openapi.js";
import { pageSchema, type Page, type PaginationQuery } from "../../../common/pagination.js";
import { uuidParam, ZodValidationPipe } from "../../../common/zod-validation.pipe.js";
import { ProductTypesService } from "./product-types.service.js";
import {
  createProductTypeSchema,
  listProductTypesQuerySchema,
  productTypeAttributeResponseSchema,
  productTypeDetailResponseSchema,
  productTypeOptionResponseSchema,
  productTypeResponseSchema,
  putProductTypeAttributeSchema,
  putProductTypeOptionSchema,
  updateProductTypeSchema,
  type CreateProductTypeBody,
  type ProductTypeAttributeResponse,
  type ProductTypeDetailResponse,
  type ProductTypeOptionResponse,
  type ProductTypeResponse,
  type PutProductTypeAttributeBody,
  type PutProductTypeOptionBody,
  type UpdateProductTypeBody,
} from "./product-types.schemas.js";

const ID_PARAM = { name: "id", format: "uuid", description: "Product type id." };
const ATTRIBUTE_ID_PARAM = { name: "attributeId", format: "uuid", description: "Attribute id." };
const OPTION_ID_PARAM = { name: "optionId", format: "uuid", description: "Option id." };

/** Thin HTTP layer: validate input, call the service, shape the status code. No rules here. */
@AdminController("product-types")
export class ProductTypesController {
  constructor(private readonly productTypes: ProductTypesService) {}

  @Post()
  @ApiOperation({ summary: "Create a product type" })
  @ApiZodBody(createProductTypeSchema)
  @ApiZodResponse(201, productTypeResponseSchema, "The created type. `Location` points to it.")
  @ApiProblemResponses(400, 409)
  async create(
    @Body(new ZodValidationPipe(createProductTypeSchema)) body: CreateProductTypeBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductTypeResponse> {
    const created = await this.productTypes.create(body);
    response.setHeader("Location", `/admin/product-types/${created.id}`);
    return created;
  }

  @Get()
  @ApiOperation({ summary: "List product types, ordered by code" })
  @ApiPaginationQuery()
  @ApiZodResponse(200, pageSchema(productTypeResponseSchema), "A page of product types.")
  @ApiProblemResponses(400)
  list(
    @Query(new ZodValidationPipe(listProductTypesQuerySchema)) query: PaginationQuery,
  ): Promise<Page<ProductTypeResponse>> {
    return this.productTypes.list(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a product type with its attribute and option assignments" })
  @ApiParam(ID_PARAM)
  @ApiZodResponse(200, productTypeDetailResponseSchema, "The product type and its assignments.")
  @ApiProblemResponses(400, 404)
  get(@Param("id", uuidParam("id")) id: string): Promise<ProductTypeDetailResponse> {
    return this.productTypes.get(id);
  }

  @Patch(":id")
  @ApiOperation({
    summary: "Change a product type (name, requiresShipping; the code never changes)",
  })
  @ApiParam(ID_PARAM)
  @ApiZodBody(updateProductTypeSchema)
  @ApiZodResponse(200, productTypeResponseSchema, "The updated type.")
  @ApiProblemResponses(400, 404)
  update(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(updateProductTypeSchema)) body: UpdateProductTypeBody,
  ): Promise<ProductTypeResponse> {
    return this.productTypes.update(id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a product type that no product uses" })
  @ApiParam(ID_PARAM)
  @ApiNoContentResponse({ description: "Deleted (its assignments are deleted with it)." })
  @ApiProblemResponses(400, 404, 409)
  delete(@Param("id", uuidParam("id")) id: string): Promise<void> {
    return this.productTypes.delete(id);
  }

  @Put(":id/attributes/:attributeId")
  @ApiOperation({
    summary: "Assign an attribute to a product type, or replace the assignment",
    description:
      "Answers 201 when the assignment is new and 200 when it replaced an existing one. Changing the level is refused while values exist.",
  })
  @ApiParam(ID_PARAM)
  @ApiParam(ATTRIBUTE_ID_PARAM)
  @ApiZodBody(putProductTypeAttributeSchema)
  @ApiZodResponse(200, productTypeAttributeResponseSchema, "The replaced assignment.")
  @ApiZodResponse(201, productTypeAttributeResponseSchema, "The new assignment.")
  @ApiProblemResponses(400, 404, 409)
  async putAttribute(
    @Param("id", uuidParam("id")) id: string,
    @Param("attributeId", uuidParam("attributeId")) attributeId: string,
    @Body(new ZodValidationPipe(putProductTypeAttributeSchema)) body: PutProductTypeAttributeBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductTypeAttributeResponse> {
    const { assignment, created } = await this.productTypes.putAttribute(id, attributeId, body);
    response.status(created ? 201 : 200);
    return assignment;
  }

  @Delete(":id/attributes/:attributeId")
  @HttpCode(204)
  @ApiOperation({ summary: "Remove an attribute from a product type that holds no values of it" })
  @ApiParam(ID_PARAM)
  @ApiParam(ATTRIBUTE_ID_PARAM)
  @ApiNoContentResponse({ description: "Removed." })
  @ApiProblemResponses(400, 404, 409)
  removeAttribute(
    @Param("id", uuidParam("id")) id: string,
    @Param("attributeId", uuidParam("attributeId")) attributeId: string,
  ): Promise<void> {
    return this.productTypes.removeAttribute(id, attributeId);
  }

  @Put(":id/options/:optionId")
  @ApiOperation({
    summary: "Allow an option on a product type, or change its position",
    description: "Answers 201 when the assignment is new and 200 when it replaced an existing one.",
  })
  @ApiParam(ID_PARAM)
  @ApiParam(OPTION_ID_PARAM)
  @ApiZodBody(putProductTypeOptionSchema)
  @ApiZodResponse(200, productTypeOptionResponseSchema, "The replaced assignment.")
  @ApiZodResponse(201, productTypeOptionResponseSchema, "The new assignment.")
  @ApiProblemResponses(400, 404)
  async putOption(
    @Param("id", uuidParam("id")) id: string,
    @Param("optionId", uuidParam("optionId")) optionId: string,
    @Body(new ZodValidationPipe(putProductTypeOptionSchema)) body: PutProductTypeOptionBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductTypeOptionResponse> {
    const { assignment, created } = await this.productTypes.putOption(id, optionId, body);
    response.status(created ? 201 : 200);
    return assignment;
  }

  @Delete(":id/options/:optionId")
  @HttpCode(204)
  @ApiOperation({ summary: "Remove an option from a product type that no product of it uses" })
  @ApiParam(ID_PARAM)
  @ApiParam(OPTION_ID_PARAM)
  @ApiNoContentResponse({ description: "Removed." })
  @ApiProblemResponses(400, 404, 409)
  removeOption(
    @Param("id", uuidParam("id")) id: string,
    @Param("optionId", uuidParam("optionId")) optionId: string,
  ): Promise<void> {
    return this.productTypes.removeOption(id, optionId);
  }
}
