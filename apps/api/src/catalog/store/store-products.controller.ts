import { Get, Param, Query } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiQuery } from "@nestjs/swagger";
import { ApiProblemResponses, ApiZodResponse } from "../../common/openapi.js";
import { pageSchema, type Page } from "../../common/pagination.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { StoreController } from "./store-controller.decorator.js";
import {
  storeProductDetailSchema,
  storeProductListItemSchema,
  storeProductQuerySchema,
  storeProductsQuerySchema,
  type StoreProductDetail,
  type StoreProductListItem,
  type StoreProductQuery,
  type StoreProductsQuery,
  slugParam,
} from "./store.schemas.js";
import { StoreService } from "./store.service.js";
import { RateLimit } from "../../rate-limit/rate-limit.decorator.js";

@StoreController("products")
export class StoreProductsController {
  constructor(private readonly store: StoreService) {}

  @Get()
  @RateLimit("catalogRead")
  @ApiOperation({
    summary:
      "List active products, newest first (published_at desc, id desc); filter by category (with descendants) and brand",
  })
  @ApiQuery({ name: "locale", required: false, schema: { type: "string" } })
  @ApiQuery({
    name: "limit",
    required: false,
    schema: { type: "integer", minimum: 1, maximum: 100, default: 24 },
  })
  @ApiQuery({
    name: "offset",
    required: false,
    schema: { type: "integer", minimum: 0, maximum: 10000, default: 0 },
  })
  @ApiQuery({
    name: "category",
    required: false,
    description:
      "Category slug: the category and all its active descendants. Unknown or inactive gives an empty list.",
    schema: { type: "string" },
  })
  @ApiQuery({
    name: "brand",
    required: false,
    description: "Brand slug. Unknown gives an empty list.",
    schema: { type: "string" },
  })
  @ApiZodResponse(200, pageSchema(storeProductListItemSchema), "A page of products.")
  @ApiProblemResponses(429)
  list(
    @Query(new ZodValidationPipe(storeProductsQuerySchema)) query: StoreProductsQuery,
  ): Promise<Page<StoreProductListItem>> {
    return this.store.listProducts(query);
  }

  @Get(":slug")
  @RateLimit("catalogRead")
  @ApiOperation({
    summary: "Get an active product by slug with options, variants, media and public attributes",
  })
  @ApiParam({ name: "slug", description: "Product slug." })
  @ApiQuery({ name: "locale", required: false, schema: { type: "string" } })
  @ApiZodResponse(200, storeProductDetailSchema, "The product.")
  @ApiProblemResponses(404, 429)
  get(
    @Param("slug", slugParam()) slug: string,
    @Query(new ZodValidationPipe(storeProductQuerySchema)) query: StoreProductQuery,
  ): Promise<StoreProductDetail> {
    return this.store.getProduct(slug, query.locale);
  }
}
