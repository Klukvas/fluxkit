import { Get } from "@nestjs/common";
import { ApiOperation } from "@nestjs/swagger";
import { ApiProblemResponses, ApiZodResponse } from "../../common/openapi.js";
import { StoreController } from "./store-controller.decorator.js";
import { storeConfigSchema, type StoreConfig } from "./store.schemas.js";
import { StoreService } from "./store.service.js";
import { RateLimit } from "../../rate-limit/rate-limit.decorator.js";

@StoreController("config")
export class StoreConfigController {
  constructor(private readonly store: StoreService) {}

  @Get()
  @RateLimit("catalogRead")
  @ApiOperation({
    summary:
      "Shop currency (with its minor-unit exponent), tax flag and locales, for formatting money and texts",
  })
  @ApiZodResponse(200, storeConfigSchema, "The public store settings.")
  @ApiProblemResponses(429)
  get(): StoreConfig {
    return this.store.getConfig();
  }
}
