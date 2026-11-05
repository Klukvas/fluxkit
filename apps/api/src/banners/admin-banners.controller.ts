import { Body, Delete, Get, HttpCode, Param, Patch, Post, Put, Res } from "@nestjs/common";
import { ApiNoContentResponse, ApiOperation, ApiParam } from "@nestjs/swagger";
import type { Response } from "express";
import { AdminController } from "../auth/admin-controller.decorator.js";
import { ApiProblemResponses, ApiZodBody, ApiZodResponse } from "../common/openapi.js";
import { uuidParam, ZodValidationPipe } from "../common/zod-validation.pipe.js";
import {
  bannerListSchema,
  bannerResponseSchema,
  createBannerSchema,
  reorderBannersSchema,
  updateBannerSchema,
  type BannerList,
  type BannerResponse,
  type CreateBannerBody,
  type ReorderBannersBody,
  type UpdateBannerBody,
} from "./banners.schemas.js";
import { BannersService } from "./banners.service.js";

const ID_PARAM = { name: "id", format: "uuid", description: "Banner id." };

/**
 * Home banners in the admin (ADR 0046). The catalog permission pair by default: `catalog.read` for reads,
 * `catalog.write` for writes. Thin HTTP layer: validate input, call the service, shape the status code.
 */
@AdminController("banners")
export class AdminBannersController {
  constructor(private readonly banners: BannersService) {}

  @Get()
  @ApiOperation({ summary: "List every home banner by position, with its state" })
  @ApiZodResponse(200, bannerListSchema, "Every banner (at most 50).")
  list(): Promise<BannerList> {
    return this.banners.list();
  }

  @Post()
  @ApiOperation({ summary: "Create a home banner (appended at the end)" })
  @ApiZodBody(createBannerSchema)
  @ApiZodResponse(201, bannerResponseSchema, "The created banner. `Location` points to it.")
  @ApiProblemResponses(400, 409)
  async create(
    @Body(new ZodValidationPipe(createBannerSchema)) body: CreateBannerBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BannerResponse> {
    const created = await this.banners.create(body);
    response.setHeader("Location", `/admin/banners/${created.id}`);
    return created;
  }

  @Put("order")
  @ApiOperation({ summary: "Reorder the home banners (every banner exactly once)" })
  @ApiZodBody(reorderBannersSchema)
  @ApiZodResponse(200, bannerListSchema, "Every banner in the new order.")
  @ApiProblemResponses(400)
  reorder(
    @Body(new ZodValidationPipe(reorderBannersSchema)) body: ReorderBannersBody,
  ): Promise<BannerList> {
    return this.banners.reorder(body);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a home banner" })
  @ApiParam(ID_PARAM)
  @ApiZodResponse(200, bannerResponseSchema, "The banner.")
  @ApiProblemResponses(400, 404)
  get(@Param("id", uuidParam("id")) id: string): Promise<BannerResponse> {
    return this.banners.get(id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Change a home banner (only the listed fields)" })
  @ApiParam(ID_PARAM)
  @ApiZodBody(updateBannerSchema)
  @ApiZodResponse(200, bannerResponseSchema, "The updated banner.")
  @ApiProblemResponses(400, 404)
  update(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(updateBannerSchema)) body: UpdateBannerBody,
  ): Promise<BannerResponse> {
    return this.banners.update(id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a home banner (its uploads and files stay)" })
  @ApiParam(ID_PARAM)
  @ApiNoContentResponse({ description: "Deleted." })
  @ApiProblemResponses(400, 404)
  delete(@Param("id", uuidParam("id")) id: string): Promise<void> {
    return this.banners.delete(id);
  }
}
