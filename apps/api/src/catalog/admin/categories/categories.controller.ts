import { Body, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from "@nestjs/common";
import { ApiNoContentResponse, ApiOperation, ApiParam, ApiQuery } from "@nestjs/swagger";
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
import { CategoriesService } from "./categories.service.js";
import {
  categoryResponseSchema,
  createCategorySchema,
  listCategoriesQuerySchema,
  moveCategorySchema,
  updateCategorySchema,
  type CategoryResponse,
  type CreateCategoryBody,
  type ListCategoriesQuery,
  type MoveCategoryBody,
  type UpdateCategoryBody,
} from "./categories.schemas.js";

const ID_PARAM = { name: "id", format: "uuid", description: "Category id." };

/** Thin HTTP layer: validate input, call the service, shape the status code. No rules here. */
@AdminController("categories")
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Post()
  @ApiOperation({ summary: "Create a category (optionally under a parent)" })
  @ApiZodBody(createCategorySchema)
  @ApiZodResponse(201, categoryResponseSchema, "The created category. `Location` points to it.")
  @ApiProblemResponses(400, 409)
  async create(
    @Body(new ZodValidationPipe(createCategorySchema)) body: CreateCategoryBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CategoryResponse> {
    const created = await this.categories.create(body);
    response.setHeader("Location", `/admin/categories/${created.id}`);
    return created;
  }

  @Get()
  @ApiOperation({
    summary:
      "List categories (flat), ordered by position, slug, id; `parentId` lists direct children",
  })
  @ApiPaginationQuery()
  @ApiQuery({
    name: "parentId",
    required: false,
    description:
      "Only the direct children of this category. Without it every category of every level is listed (there is no value that selects the root level only).",
    schema: { type: "string", format: "uuid" },
  })
  @ApiZodResponse(200, pageSchema(categoryResponseSchema), "A page of categories.")
  @ApiProblemResponses(400)
  list(
    @Query(new ZodValidationPipe(listCategoriesQuerySchema)) query: ListCategoriesQuery,
  ): Promise<Page<CategoryResponse>> {
    return this.categories.list(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a category" })
  @ApiParam(ID_PARAM)
  @ApiZodResponse(200, categoryResponseSchema, "The category.")
  @ApiProblemResponses(400, 404)
  get(@Param("id", uuidParam("id")) id: string): Promise<CategoryResponse> {
    return this.categories.get(id);
  }

  @Patch(":id")
  @ApiOperation({
    summary: "Change a category (only the listed fields; the tree position changes via move)",
  })
  @ApiParam(ID_PARAM)
  @ApiZodBody(updateCategorySchema)
  @ApiZodResponse(200, categoryResponseSchema, "The updated category.")
  @ApiProblemResponses(400, 404, 409)
  update(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(updateCategorySchema)) body: UpdateCategoryBody,
  ): Promise<CategoryResponse> {
    return this.categories.update(id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a category that has no children and no products" })
  @ApiParam(ID_PARAM)
  @ApiNoContentResponse({ description: "Deleted." })
  @ApiProblemResponses(400, 404, 409)
  delete(@Param("id", uuidParam("id")) id: string): Promise<void> {
    return this.categories.delete(id);
  }

  @Post(":id/move")
  @HttpCode(200)
  @ApiOperation({
    summary: "Move a category under another parent (null = root) at a position among its siblings",
  })
  @ApiParam(ID_PARAM)
  @ApiZodBody(moveCategorySchema)
  @ApiZodResponse(200, categoryResponseSchema, "The moved category.")
  @ApiProblemResponses(400, 404, 409)
  move(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(moveCategorySchema)) body: MoveCategoryBody,
  ): Promise<CategoryResponse> {
    return this.categories.move(id, body);
  }
}
