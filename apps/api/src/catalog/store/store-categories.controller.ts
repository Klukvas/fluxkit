import { Get, Query } from "@nestjs/common";
import { ApiOperation, ApiQuery } from "@nestjs/swagger";
import { ApiZodResponse } from "../../common/openapi.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { StoreController } from "./store-controller.decorator.js";
import {
  storeCategoriesQuerySchema,
  storeCategoryTreeSchema,
  type StoreCategoriesQuery,
  type StoreCategoryNode,
} from "./store.schemas.js";
import { StoreService } from "./store.service.js";

@StoreController("categories")
export class StoreCategoriesController {
  constructor(private readonly store: StoreService) {}

  @Get()
  @ApiOperation({
    summary:
      "Public category tree: active categories whose ancestors are all active, ordered by position, slug",
  })
  @ApiQuery({ name: "locale", required: false, schema: { type: "string" } })
  @ApiZodResponse(200, storeCategoryTreeSchema, "The tree, wrapped in `items`.")
  list(
    @Query(new ZodValidationPipe(storeCategoriesQuerySchema)) query: StoreCategoriesQuery,
  ): Promise<{ items: StoreCategoryNode[] }> {
    return this.store.listCategories(query.locale);
  }
}
