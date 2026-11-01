import { Get, Inject, Query, Res } from "@nestjs/common";
import { ApiOperation, ApiQuery } from "@nestjs/swagger";
import type { Response } from "express";
import { StoreController } from "../../catalog/store/store-controller.decorator.js";
import { ApiProblemResponses, ApiZodResponse } from "../../common/openapi.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { RateLimit } from "../../rate-limit/rate-limit.decorator.js";
import {
  storeSearchQuerySchema,
  storeSearchResponseSchema,
  storeSuggestQuerySchema,
  storeSuggestResponseSchema,
  type StoreSearchQuery,
  type StoreSearchResponse,
  type StoreSuggestQuery,
  type StoreSuggestResponse,
} from "./store-search.schemas.js";
import { StoreSearchService } from "./store-search.service.js";

/**
 * Fires when the shopper's connection closes before the answer was sent (a closed tab, a client timeout), so the search
 * stops spending engine work on it: its waiting pass leaves the queue and its running engine calls are destroyed
 * (ADR 0042).
 */
function abandonedSignal(response: Response): AbortSignal {
  const controller = new AbortController();
  response.once("close", () => {
    if (!response.writableFinished) {
      controller.abort();
    }
  });
  return controller.signal;
}

/**
 * Catalog search of the store (ADR 0034 decision 10, `docs/api/search.md`). Mounted only with `SEARCH_ENABLED=true`;
 * otherwise both routes answer 404. Public, rate limited per client address (windows `search` and `searchSuggest`).
 */
@StoreController("search")
export class StoreSearchController {
  constructor(@Inject(StoreSearchService) private readonly search: StoreSearchService) {}

  @Get()
  @RateLimit("search")
  @ApiOperation({
    summary:
      "Search products: text query, facets (brand, category, in stock, options, filterable attributes), price range, sort and pages",
  })
  @ApiQuery({ name: "q", required: false, schema: { type: "string", maxLength: 200 } })
  @ApiQuery({ name: "locale", required: false, schema: { type: "string" } })
  @ApiQuery({
    name: "f",
    required: false,
    description:
      "Repeated `<facetKey>:<value>` (`brand:<slug>`, `category:<uuid>`, `inStock:true`, `opt.<code>:<value>`, `attr.<code>:<value|true|false|min..max>`).",
    schema: { type: "array", items: { type: "string" } },
    style: "form",
    explode: true,
  })
  @ApiQuery({
    name: "price",
    required: false,
    description: "`<min>..<max>` in minor units.",
    schema: { type: "string" },
  })
  @ApiQuery({
    name: "sort",
    required: false,
    schema: { type: "string", enum: ["relevance", "newest", "price_asc", "price_desc"] },
  })
  @ApiQuery({ name: "page", required: false, schema: { type: "integer", minimum: 1, default: 1 } })
  @ApiQuery({
    name: "limit",
    required: false,
    schema: { type: "integer", minimum: 1, maximum: 48, default: 24 },
  })
  @ApiZodResponse(200, storeSearchResponseSchema, "A page of products with facets.")
  @ApiProblemResponses(429, 503)
  async list(
    @Query(new ZodValidationPipe(storeSearchQuerySchema)) query: StoreSearchQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StoreSearchResponse> {
    const result = await this.search.search(query, abandonedSignal(response));
    // No personal data in the answer; prices and availability are current to the second they were read.
    response.setHeader("Cache-Control", "public, max-age=30");
    return result;
  }

  @Get("suggest")
  @RateLimit("searchSuggest")
  @ApiOperation({
    summary:
      "At most 6 product suggestions (slug and title) for text typed so far (2 characters or more)",
  })
  @ApiQuery({ name: "q", required: true, schema: { type: "string", minLength: 2, maxLength: 200 } })
  @ApiQuery({ name: "locale", required: false, schema: { type: "string" } })
  @ApiZodResponse(200, storeSuggestResponseSchema, "The suggestions, best first.")
  @ApiProblemResponses(429, 503)
  async suggest(
    @Query(new ZodValidationPipe(storeSuggestQuerySchema)) query: StoreSuggestQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StoreSuggestResponse> {
    const result = await this.search.suggest(query, abandonedSignal(response));
    response.setHeader("Cache-Control", "no-store");
    return result;
  }
}
