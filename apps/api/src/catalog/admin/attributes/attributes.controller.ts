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
import { AttributesService } from "./attributes.service.js";
import {
  attributeDetailResponseSchema,
  attributeOptionResponseSchema,
  attributeResponseSchema,
  createAttributeOptionSchema,
  createAttributeSchema,
  listAttributesQuerySchema,
  updateAttributeOptionSchema,
  updateAttributeSchema,
  type AttributeDetailResponse,
  type AttributeOptionResponse,
  type AttributeResponse,
  type CreateAttributeBody,
  type CreateAttributeOptionBody,
  type UpdateAttributeBody,
  type UpdateAttributeOptionBody,
} from "./attributes.schemas.js";

const ID_PARAM = { name: "id", format: "uuid", description: "Attribute id." };
const OPTION_ID_PARAM = { name: "optionId", format: "uuid", description: "Attribute option id." };

/** Thin HTTP layer: validate input, call the service, shape the status code. No rules here. */
@AdminController("attributes")
export class AttributesController {
  constructor(private readonly attributes: AttributesService) {}

  @Post()
  @ApiOperation({ summary: "Create an attribute" })
  @ApiZodBody(createAttributeSchema)
  @ApiZodResponse(201, attributeResponseSchema, "The created attribute. `Location` points to it.")
  @ApiProblemResponses(400, 409)
  async create(
    @Body(new ZodValidationPipe(createAttributeSchema)) body: CreateAttributeBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AttributeResponse> {
    const created = await this.attributes.create(body);
    response.setHeader("Location", `/admin/attributes/${created.id}`);
    return created;
  }

  @Get()
  @ApiOperation({ summary: "List attributes, ordered by code" })
  @ApiPaginationQuery()
  @ApiZodResponse(200, pageSchema(attributeResponseSchema), "A page of attributes.")
  @ApiProblemResponses(400)
  list(
    @Query(new ZodValidationPipe(listAttributesQuerySchema)) query: PaginationQuery,
  ): Promise<Page<AttributeResponse>> {
    return this.attributes.list(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get an attribute with its options" })
  @ApiParam(ID_PARAM)
  @ApiZodResponse(200, attributeDetailResponseSchema, "The attribute and its options.")
  @ApiProblemResponses(400, 404)
  get(@Param("id", uuidParam("id")) id: string): Promise<AttributeDetailResponse> {
    return this.attributes.get(id);
  }

  @Patch(":id")
  @ApiOperation({
    summary: "Change an attribute (only the listed fields)",
    description:
      "The code never changes. A different `inputType` or `isLocalized` answers 409 rule_violation; a different `unit` is refused while values exist.",
  })
  @ApiParam(ID_PARAM)
  @ApiZodBody(updateAttributeSchema)
  @ApiZodResponse(200, attributeResponseSchema, "The updated attribute.")
  @ApiProblemResponses(400, 404, 409)
  update(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(updateAttributeSchema)) body: UpdateAttributeBody,
  ): Promise<AttributeResponse> {
    return this.attributes.update(id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete an attribute that no product type assigns" })
  @ApiParam(ID_PARAM)
  @ApiNoContentResponse({ description: "Deleted (its options are deleted with it)." })
  @ApiProblemResponses(400, 404, 409)
  delete(@Param("id", uuidParam("id")) id: string): Promise<void> {
    return this.attributes.delete(id);
  }

  @Post(":id/options")
  @ApiOperation({ summary: "Add an option to a select or multiselect attribute" })
  @ApiParam(ID_PARAM)
  @ApiZodBody(createAttributeOptionSchema)
  @ApiZodResponse(201, attributeOptionResponseSchema, "The created option.")
  @ApiProblemResponses(400, 404, 409)
  async createOption(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(createAttributeOptionSchema)) body: CreateAttributeOptionBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AttributeOptionResponse> {
    const created = await this.attributes.createOption(id, body);
    response.setHeader("Location", `/admin/attributes/${id}/options/${created.id}`);
    return created;
  }

  @Patch(":id/options/:optionId")
  @ApiOperation({ summary: "Change an attribute option (label, position)" })
  @ApiParam(ID_PARAM)
  @ApiParam(OPTION_ID_PARAM)
  @ApiZodBody(updateAttributeOptionSchema)
  @ApiZodResponse(200, attributeOptionResponseSchema, "The updated option.")
  @ApiProblemResponses(400, 404)
  updateOption(
    @Param("id", uuidParam("id")) id: string,
    @Param("optionId", uuidParam("optionId")) optionId: string,
    @Body(new ZodValidationPipe(updateAttributeOptionSchema)) body: UpdateAttributeOptionBody,
  ): Promise<AttributeOptionResponse> {
    return this.attributes.updateOption(id, optionId, body);
  }

  @Delete(":id/options/:optionId")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete an attribute option that no value uses" })
  @ApiParam(ID_PARAM)
  @ApiParam(OPTION_ID_PARAM)
  @ApiNoContentResponse({ description: "Deleted." })
  @ApiProblemResponses(400, 404, 409)
  deleteOption(
    @Param("id", uuidParam("id")) id: string,
    @Param("optionId", uuidParam("optionId")) optionId: string,
  ): Promise<void> {
    return this.attributes.deleteOption(id, optionId);
  }
}
