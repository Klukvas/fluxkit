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
import { ApiNoContentResponse, ApiOperation, ApiParam, ApiQuery } from "@nestjs/swagger";
import type { Response } from "express";
import type { AdminPrincipal } from "../../auth/admin-authenticator.js";
import { AdminController } from "../../auth/admin-controller.decorator.js";
import { CurrentAdmin } from "../../auth/current-admin.js";
import {
  ApiPaginationQuery,
  ApiProblemResponses,
  ApiZodBody,
  ApiZodResponse,
} from "../../common/openapi.js";
import { pageSchema, type Page } from "../../common/pagination.js";
import { uuidParam, ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import {
  adminSearchRebuildSchema,
  adminSearchStatusSchema,
  createSynonymGroupSchema,
  listSynonymGroupsQuerySchema,
  synonymGroupSchema,
  updateSynonymGroupSchema,
  type AdminSearchRebuild,
  type AdminSearchStatus,
  type CreateSynonymGroupBody,
  type ListSynonymGroupsQuery,
  type SynonymGroupResponse,
  type UpdateSynonymGroupBody,
} from "./admin-search.schemas.js";
import { AdminSearchService } from "./admin-search.service.js";

const ID_PARAM = { name: "id", format: "uuid", description: "Synonym group id." };

/**
 * Admin search (ADR 0034 decision 10, `docs/api/search.md`): reads need `catalog.read`, writes `catalog.write` (the
 * `@AdminController` defaults; plan question 12). Mounted only with `SEARCH_ENABLED=true`, otherwise 404.
 */
@AdminController("search")
export class AdminSearchController {
  constructor(@Inject(AdminSearchService) private readonly search: AdminSearchService) {}

  @Get("status")
  @ApiOperation({
    summary:
      "Index state per locale (live index, documents, freshness, rebuild, failures), queue depth and engine reachability",
  })
  @ApiZodResponse(200, adminSearchStatusSchema, "The status.")
  status(): Promise<AdminSearchStatus> {
    return this.search.status(new Date());
  }

  @Post("rebuild")
  @HttpCode(202)
  @ApiOperation({
    summary:
      "Request a rebuild of every locale's index (job 14 builds it and swaps it in; idempotent while one runs)",
  })
  @ApiZodResponse(202, adminSearchRebuildSchema, "The request is recorded.")
  rebuild(): Promise<AdminSearchRebuild> {
    return this.search.requestRebuild(new Date());
  }

  @Get("synonyms")
  @ApiOperation({ summary: "List synonym groups, by locale then creation time" })
  @ApiPaginationQuery()
  @ApiQuery({
    name: "locale",
    required: false,
    schema: { type: "string" },
    description: "Only the groups of this configured locale.",
  })
  @ApiZodResponse(200, pageSchema(synonymGroupSchema), "A page of synonym groups.")
  @ApiProblemResponses(400)
  list(
    @Query(new ZodValidationPipe(listSynonymGroupsQuerySchema)) query: ListSynonymGroupsQuery,
  ): Promise<Page<SynonymGroupResponse>> {
    return this.search.listSynonyms(query);
  }

  @Post("synonyms")
  @ApiOperation({
    summary: "Create a synonym group of one locale (applied to the index by job 13, no rebuild)",
  })
  @ApiZodBody(createSynonymGroupSchema)
  @ApiZodResponse(201, synonymGroupSchema, "The created group. `Location` points to it.")
  @ApiProblemResponses(400)
  async create(
    @Body(new ZodValidationPipe(createSynonymGroupSchema)) body: CreateSynonymGroupBody,
    @CurrentAdmin() admin: AdminPrincipal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SynonymGroupResponse> {
    const created = await this.search.createSynonyms(body, admin.userId);
    response.setHeader("Location", `/admin/search/synonyms/${created.id}`);
    return created;
  }

  @Patch("synonyms/:id")
  @ApiOperation({ summary: "Replace the terms of a synonym group" })
  @ApiParam(ID_PARAM)
  @ApiZodBody(updateSynonymGroupSchema)
  @ApiZodResponse(200, synonymGroupSchema, "The updated group.")
  @ApiProblemResponses(400, 404)
  update(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(updateSynonymGroupSchema)) body: UpdateSynonymGroupBody,
  ): Promise<SynonymGroupResponse> {
    return this.search.updateSynonyms(id, body);
  }

  @Delete("synonyms/:id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a synonym group" })
  @ApiParam(ID_PARAM)
  @ApiNoContentResponse({ description: "Deleted." })
  @ApiProblemResponses(400, 404)
  async remove(@Param("id", uuidParam("id")) id: string): Promise<void> {
    await this.search.deleteSynonyms(id);
  }
}
