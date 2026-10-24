import { Get, Inject, Param, Query, Req, Res } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiQuery } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { SHIPPING_PROVIDER_CODE_PATTERN } from "@fluxkit/core";
import { z } from "zod";
import { resolveShopper } from "../../cart/cart-owner.js";
import { StoreController } from "../../catalog/store/store-controller.decorator.js";
import { ApiProblemResponses, ApiZodResponse } from "../../common/openapi.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import {
  CUSTOMER_AUTHENTICATOR,
  type CustomerAuthenticator,
} from "../../customers/auth/customer-authenticator.js";
import { RateLimit } from "../../rate-limit/rate-limit.decorator.js";
import { ShippingLookupService } from "./shipping-lookup.service.js";
import { ShippingOptionsService } from "./shipping-options.service.js";
import {
  shippingCitiesQuerySchema,
  shippingCityPageSchema,
  shippingOptionsQuerySchema,
  shippingOptionsResponseSchema,
  shippingPickupPointPageSchema,
  shippingPickupPointsQuerySchema,
  type ShippingCitiesQuery,
  type ShippingCityPage,
  type ShippingOptionsQuery,
  type ShippingOptionsResponse,
  type ShippingPickupPointPage,
  type ShippingPickupPointsQuery,
} from "./shipping-store.schemas.js";

/** Carrier directory data is public, not personal: browsers and shared caches may keep a successful answer 5 minutes. */
export const LOOKUP_CACHE_CONTROL = "public, max-age=300";

const CODE_PARAM = {
  name: "code",
  description: "Provider code of an enabled shipping provider.",
  schema: { type: "string", pattern: SHIPPING_PROVIDER_CODE_PATTERN.source },
};

const providerCodeParam = new ZodValidationPipe(
  z.string().regex(SHIPPING_PROVIDER_CODE_PATTERN, "Not a provider code."),
  "code",
);

/**
 * Thin HTTP layer of the store shipping routes (ADR 0029 decision 5). Public `GET`s. The options follow the cart (session
 * or `fluxkit_cart` cookie, never a request field) and are `no-store`; the lookups carry no personal data and may be cached
 * for 5 minutes when they succeed (errors stay `no-store`, set by the module's middleware). Limited per address.
 */
@StoreController("shipping")
export class ShippingStoreController {
  constructor(
    @Inject(ShippingOptionsService) private readonly options: ShippingOptionsService,
    @Inject(ShippingLookupService) private readonly lookups: ShippingLookupService,
    @Inject(CUSTOMER_AUTHENTICATOR) private readonly authenticator: CustomerAuthenticator,
  ) {}

  @Get("options")
  @RateLimit("shippingOptions")
  @ApiOperation({
    summary: "The shipping methods for the current cart, priced by the server",
    description:
      "Each active method in the shop currency with `available`, the shop's `price` and the `total` (cart subtotal plus price) the checkout expects as `expectedTotal`. `estimate` is the carrier's own price, informational only, filled when `cityRef` or `pickupPointRef` names a destination and the carrier answers within 5 s. Empty for an empty cart, a cart that ships nothing, and a shop without an active method. Never creates a cart.",
  })
  @ApiQuery({ name: "country", required: false, schema: { type: "string", pattern: "^[A-Z]{2}$" } })
  @ApiQuery({ name: "locale", required: false, schema: { type: "string" } })
  @ApiQuery({ name: "cityRef", required: false, schema: { type: "string" } })
  @ApiQuery({ name: "pickupPointRef", required: false, schema: { type: "string" } })
  @ApiZodResponse(200, shippingOptionsResponseSchema, "The options.")
  @ApiProblemResponses(409, 429)
  async listOptions(
    @Req() request: Request,
    @Query(new ZodValidationPipe(shippingOptionsQuerySchema)) parsed: ShippingOptionsQuery,
  ): Promise<ShippingOptionsResponse> {
    const shopper = await resolveShopper(this.authenticator, request);
    return this.options.options(shopper.owner, parsed);
  }

  @Get("providers/:code/cities")
  @RateLimit("shippingLookup")
  @ApiOperation({
    summary: "Search the cities of a shipping provider",
    description:
      "Through the API's cache (24 h; when the carrier is down, cached data up to 72 h past its expiry is served with `stale: true`). 503 `shipping_provider_unavailable` with `Retry-After` when the carrier cannot be reached and nothing is cached.",
  })
  @ApiParam(CODE_PARAM)
  @ApiQuery({ name: "q", required: true, schema: { type: "string", minLength: 2, maxLength: 50 } })
  @ApiQuery({ name: "locale", required: false, schema: { type: "string" } })
  @ApiQuery({
    name: "limit",
    required: false,
    schema: { type: "integer", minimum: 1, maximum: 50, default: 20 },
  })
  @ApiQuery({
    name: "offset",
    required: false,
    schema: { type: "integer", minimum: 0, maximum: 10000, default: 0 },
  })
  @ApiZodResponse(200, shippingCityPageSchema, "One page of cities.")
  @ApiProblemResponses(404, 429, 503)
  async cities(
    @Param("code", providerCodeParam) code: string,
    @Query(new ZodValidationPipe(shippingCitiesQuerySchema)) parsed: ShippingCitiesQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ShippingCityPage> {
    const page = await this.lookups.cities(code, parsed);
    response.setHeader("Cache-Control", LOOKUP_CACHE_CONTROL);
    return page;
  }

  @Get("providers/:code/pickup-points")
  @RateLimit("shippingLookup")
  @ApiOperation({
    summary: "The pickup points (branches, parcel lockers) of a city",
    description:
      "The city's full list is fetched once and filtered here (cache 12 h, stale up to 72 h past its expiry with `stale: true`). 503 `shipping_provider_unavailable` with `Retry-After` when the carrier cannot be reached and nothing is cached.",
  })
  @ApiParam(CODE_PARAM)
  @ApiQuery({ name: "cityRef", required: true, schema: { type: "string" } })
  @ApiQuery({ name: "q", required: false, schema: { type: "string", maxLength: 50 } })
  @ApiQuery({
    name: "kinds",
    required: false,
    description: "Comma-separated `branch`, `locker`; both by default.",
    schema: { type: "string" },
  })
  @ApiQuery({
    name: "limit",
    required: false,
    schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
  })
  @ApiQuery({
    name: "offset",
    required: false,
    schema: { type: "integer", minimum: 0, maximum: 10000, default: 0 },
  })
  @ApiZodResponse(200, shippingPickupPointPageSchema, "One page of pickup points.")
  @ApiProblemResponses(404, 429, 503)
  async pickupPoints(
    @Param("code", providerCodeParam) code: string,
    @Query(new ZodValidationPipe(shippingPickupPointsQuerySchema))
    parsed: ShippingPickupPointsQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ShippingPickupPointPage> {
    const page = await this.lookups.pickupPoints(code, parsed);
    response.setHeader("Cache-Control", LOOKUP_CACHE_CONTROL);
    return page;
  }
}
