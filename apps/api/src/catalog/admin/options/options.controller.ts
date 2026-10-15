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
import { OptionsService } from "./options.service.js";
import {
  createOptionSchema,
  createOptionValueSchema,
  listOptionsQuerySchema,
  optionDetailResponseSchema,
  optionResponseSchema,
  optionValueResponseSchema,
  updateOptionSchema,
  updateOptionValueSchema,
  type CreateOptionBody,
  type CreateOptionValueBody,
  type OptionDetailResponse,
  type OptionResponse,
  type OptionValueResponse,
  type UpdateOptionBody,
  type UpdateOptionValueBody,
} from "./options.schemas.js";

const ID_PARAM = { name: "id", format: "uuid", description: "Option id." };
const VALUE_ID_PARAM = { name: "valueId", format: "uuid", description: "Option value id." };

/** Thin HTTP layer: validate input, call the service, shape the status code. No rules here. */
@AdminController("options")
export class OptionsController {
  constructor(private readonly options: OptionsService) {}

  @Post()
  @ApiOperation({ summary: "Create an option (a variant axis such as color or size)" })
  @ApiZodBody(createOptionSchema)
  @ApiZodResponse(201, optionResponseSchema, "The created option. `Location` points to it.")
  @ApiProblemResponses(400, 409)
  async create(
    @Body(new ZodValidationPipe(createOptionSchema)) body: CreateOptionBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OptionResponse> {
    const created = await this.options.create(body);
    response.setHeader("Location", `/admin/options/${created.id}`);
    return created;
  }

  @Get()
  @ApiOperation({ summary: "List options, ordered by code" })
  @ApiPaginationQuery()
  @ApiZodResponse(200, pageSchema(optionResponseSchema), "A page of options.")
  @ApiProblemResponses(400)
  list(
    @Query(new ZodValidationPipe(listOptionsQuerySchema)) query: PaginationQuery,
  ): Promise<Page<OptionResponse>> {
    return this.options.list(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get an option with its values" })
  @ApiParam(ID_PARAM)
  @ApiZodResponse(200, optionDetailResponseSchema, "The option and its values.")
  @ApiProblemResponses(400, 404)
  get(@Param("id", uuidParam("id")) id: string): Promise<OptionDetailResponse> {
    return this.options.get(id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Change an option's name (the code never changes)" })
  @ApiParam(ID_PARAM)
  @ApiZodBody(updateOptionSchema)
  @ApiZodResponse(200, optionResponseSchema, "The updated option.")
  @ApiProblemResponses(400, 404)
  update(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(updateOptionSchema)) body: UpdateOptionBody,
  ): Promise<OptionResponse> {
    return this.options.update(id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete an option that no product type assigns and no product uses" })
  @ApiParam(ID_PARAM)
  @ApiNoContentResponse({ description: "Deleted (its values are deleted with it)." })
  @ApiProblemResponses(400, 404, 409)
  delete(@Param("id", uuidParam("id")) id: string): Promise<void> {
    return this.options.delete(id);
  }

  @Post(":id/values")
  @ApiOperation({ summary: "Add a value to an option" })
  @ApiParam(ID_PARAM)
  @ApiZodBody(createOptionValueSchema)
  @ApiZodResponse(201, optionValueResponseSchema, "The created value.")
  @ApiProblemResponses(400, 404, 409)
  async createValue(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(createOptionValueSchema)) body: CreateOptionValueBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OptionValueResponse> {
    const created = await this.options.createValue(id, body);
    response.setHeader("Location", `/admin/options/${id}/values/${created.id}`);
    return created;
  }

  @Patch(":id/values/:valueId")
  @ApiOperation({ summary: "Change an option value (label, position)" })
  @ApiParam(ID_PARAM)
  @ApiParam(VALUE_ID_PARAM)
  @ApiZodBody(updateOptionValueSchema)
  @ApiZodResponse(200, optionValueResponseSchema, "The updated value.")
  @ApiProblemResponses(400, 404)
  updateValue(
    @Param("id", uuidParam("id")) id: string,
    @Param("valueId", uuidParam("valueId")) valueId: string,
    @Body(new ZodValidationPipe(updateOptionValueSchema)) body: UpdateOptionValueBody,
  ): Promise<OptionValueResponse> {
    return this.options.updateValue(id, valueId, body);
  }

  @Delete(":id/values/:valueId")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete an option value that no product uses" })
  @ApiParam(ID_PARAM)
  @ApiParam(VALUE_ID_PARAM)
  @ApiNoContentResponse({ description: "Deleted." })
  @ApiProblemResponses(400, 404, 409)
  deleteValue(
    @Param("id", uuidParam("id")) id: string,
    @Param("valueId", uuidParam("valueId")) valueId: string,
  ): Promise<void> {
    return this.options.deleteValue(id, valueId);
  }
}
