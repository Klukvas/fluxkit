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
import { pageSchema, type Page, type PaginationQuery } from "../../../common/pagination.js";
import { uuidParam, ZodValidationPipe } from "../../../common/zod-validation.pipe.js";
import { BrandsService } from "./brands.service.js";
import {
  brandResponseSchema,
  createBrandSchema,
  listBrandsQuerySchema,
  updateBrandSchema,
  type BrandResponse,
  type CreateBrandBody,
  type UpdateBrandBody,
} from "./brands.schemas.js";

const ID_PARAM = { name: "id", format: "uuid", description: "Brand id." };

/** Thin HTTP layer: validate input, call the service, shape the status code. No rules here. */
@AdminController("brands")
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Post()
  @ApiOperation({ summary: "Create a brand" })
  @ApiZodBody(createBrandSchema)
  @ApiZodResponse(201, brandResponseSchema, "The created brand. `Location` points to it.")
  @ApiProblemResponses(400, 409)
  async create(
    @Body(new ZodValidationPipe(createBrandSchema)) body: CreateBrandBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BrandResponse> {
    const created = await this.brands.create(body);
    response.setHeader("Location", `/admin/brands/${created.id}`);
    return created;
  }

  @Get()
  @ApiOperation({ summary: "List brands, ordered by slug" })
  @ApiPaginationQuery()
  @ApiZodResponse(200, pageSchema(brandResponseSchema), "A page of brands.")
  @ApiProblemResponses(400)
  list(
    @Query(new ZodValidationPipe(listBrandsQuerySchema)) query: PaginationQuery,
  ): Promise<Page<BrandResponse>> {
    return this.brands.list(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a brand" })
  @ApiParam(ID_PARAM)
  @ApiZodResponse(200, brandResponseSchema, "The brand.")
  @ApiProblemResponses(400, 404)
  get(@Param("id", uuidParam("id")) id: string): Promise<BrandResponse> {
    return this.brands.get(id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Change a brand (only the listed fields)" })
  @ApiParam(ID_PARAM)
  @ApiZodBody(updateBrandSchema)
  @ApiZodResponse(200, brandResponseSchema, "The updated brand.")
  @ApiProblemResponses(400, 404, 409)
  update(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(updateBrandSchema)) body: UpdateBrandBody,
  ): Promise<BrandResponse> {
    return this.brands.update(id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a brand that no product uses" })
  @ApiParam(ID_PARAM)
  @ApiNoContentResponse({ description: "Deleted." })
  @ApiProblemResponses(400, 404, 409)
  delete(@Param("id", uuidParam("id")) id: string): Promise<void> {
    return this.brands.delete(id);
  }
}
