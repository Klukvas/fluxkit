import { Body, Get, HttpCode, Inject, Param, Post, Put } from "@nestjs/common";
import { ApiOperation, ApiParam } from "@nestjs/swagger";
import { SHIPPING_PROVIDER_CODE_PATTERN } from "@fluxkit/core";
import { z } from "zod";
import { AdminController } from "../../auth/admin-controller.decorator.js";
import type { AdminPrincipal } from "../../auth/admin-authenticator.js";
import { CurrentAdmin } from "../../auth/current-admin.js";
import { ApiProblemResponses, ApiZodBody, ApiZodResponse } from "../../common/openapi.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { RateLimit } from "../../rate-limit/rate-limit.decorator.js";
import { SHIPPING_ADMIN_PERMISSIONS } from "./shipping-admin-permissions.js";
import {
  providerCheckResponseSchema,
  providerSettingsResponseSchema,
  putProviderSettingsSchema,
  type PutProviderSettingsBody,
  type ProviderCheckResponse,
  type ProviderSettingsResponse,
} from "./shipping-providers.schemas.js";
import { ShippingProvidersService } from "./shipping-providers.service.js";

const CODE_PARAM = {
  name: "code",
  description: "Provider code of an enabled shipping provider (`SHIPPING_PROVIDERS_ENABLED`).",
  schema: { type: "string", pattern: SHIPPING_PROVIDER_CODE_PATTERN.source },
};

const providerCodeParam = new ZodValidationPipe(
  z.string().regex(SHIPPING_PROVIDER_CODE_PATTERN, "Not a provider code."),
  "code",
);

/** Thin HTTP layer of the provider profiles. Every route needs `shipping.manage` (the controller's default pair). */
@AdminController("shipping", SHIPPING_ADMIN_PERMISSIONS)
export class ShippingProvidersController {
  constructor(
    @Inject(ShippingProvidersService) private readonly providers: ShippingProvidersService,
  ) {}

  @Get("providers/:code/settings")
  @ApiOperation({
    summary: "Get the non-secret settings of a shipping provider",
    description: "A provider with nothing saved yet answers `{}` and `updatedAt: null`.",
  })
  @ApiParam(CODE_PARAM)
  @ApiZodResponse(200, providerSettingsResponseSchema, "The saved settings.")
  @ApiProblemResponses(400, 404)
  getSettings(@Param("code", providerCodeParam) code: string): Promise<ProviderSettingsResponse> {
    return this.providers.getSettings(code);
  }

  @Put("providers/:code/settings")
  @ApiOperation({
    summary: "Replace the non-secret settings of a shipping provider",
    description:
      "Records who saved them. Credentials never belong here: they are read from the environment, and a key named like a credential is refused. A bounded check first, then the provider's own rules (`validateSettings`): their issues are `400 validation_failed` at `settings.<path>`.",
  })
  @ApiParam(CODE_PARAM)
  @ApiZodBody(putProviderSettingsSchema)
  @ApiZodResponse(200, providerSettingsResponseSchema, "The saved settings.")
  @ApiProblemResponses(400, 404)
  putSettings(
    @Param("code", providerCodeParam) code: string,
    @Body(new ZodValidationPipe(putProviderSettingsSchema)) body: PutProviderSettingsBody,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<ProviderSettingsResponse> {
    return this.providers.putSettings(code, body.settings, admin.userId);
  }

  @Post("providers/:code/check")
  @HttpCode(200)
  @RateLimit("shippingCheck")
  @ApiOperation({
    summary: "Test the connection to a shipping provider",
    description:
      "Answers 200 with `{ok: true}` or `{ok: false, reason, providerCodes}` (carrier codes only, never message text or the key). Limited per signed-in admin.",
  })
  @ApiParam(CODE_PARAM)
  @ApiZodResponse(200, providerCheckResponseSchema, "The result of the check.")
  @ApiProblemResponses(400, 404, 429)
  check(@Param("code", providerCodeParam) code: string): Promise<ProviderCheckResponse> {
    return this.providers.check(code);
  }
}
