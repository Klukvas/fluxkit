import { Get, Query } from "@nestjs/common";
import { ApiOperation, ApiQuery } from "@nestjs/swagger";
import { StoreController } from "../catalog/store/store-controller.decorator.js";
import { ApiProblemResponses, ApiZodResponse } from "../common/openapi.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import {
  storeBannerListSchema,
  storeBannersQuerySchema,
  type StoreBannerList,
  type StoreBannersQuery,
} from "./banners.schemas.js";
import { StoreBannersService } from "./store-banners.service.js";
import { RateLimit } from "../rate-limit/rate-limit.decorator.js";

/** Public, read-only, no cookie and no `Cache-Control` from the API (like `GET /store/categories`). */
@StoreController("banners")
export class StoreBannersController {
  constructor(private readonly banners: StoreBannersService) {}

  @Get()
  @RateLimit("catalogRead")
  @ApiOperation({
    summary: "Home banners live now: active and inside their window, at most 3, by position",
  })
  @ApiQuery({ name: "locale", required: false, schema: { type: "string" } })
  @ApiZodResponse(200, storeBannerListSchema, "The live banners, wrapped in `items`.")
  @ApiProblemResponses(429)
  list(
    @Query(new ZodValidationPipe(storeBannersQuerySchema)) query: StoreBannersQuery,
  ): Promise<StoreBannerList> {
    return this.banners.list(query.locale);
  }
}
