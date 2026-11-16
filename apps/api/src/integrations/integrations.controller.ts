import { Body, Get, HttpCode, Inject, Param, Post, Put, Req } from "@nestjs/common";
import { ApiOperation, ApiParam } from "@nestjs/swagger";
import { INTEGRATION_SECRET_FIELD_PATTERN } from "@fluxkit/core";
import type { Request } from "express";
import { z } from "zod";
import { AdminController } from "../auth/admin-controller.decorator.js";
import type { AdminPrincipal } from "../auth/admin-authenticator.js";
import { CurrentAdmin } from "../auth/current-admin.js";
import { ApiProblemResponses, ApiZodBody, ApiZodResponse } from "../common/openapi.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { INTEGRATIONS_ADMIN_PERMISSIONS } from "./integrations.permissions.js";
import {
  integrationDetailResponseSchema,
  integrationListResponseSchema,
  putIntegrationSecretSchema,
  retireIntegrationSecretSchema,
  type IntegrationDetailResponse,
  type IntegrationListResponse,
  type PutIntegrationSecretBody,
  type RetireIntegrationSecretBody,
} from "./integrations.schemas.js";
import { IntegrationsService, type IntegrationActor } from "./integrations.service.js";

const ID_PARAM = {
  name: "id",
  description: "Integration id from `GET /admin/integrations`.",
  schema: { type: "string", format: "uuid" },
};
const FIELD_PARAM = {
  name: "field",
  description: "A secret field the provider declares, e.g. `api_key`.",
  schema: { type: "string", pattern: INTEGRATION_SECRET_FIELD_PATTERN.source },
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const idParam = new ZodValidationPipe(z.string().regex(UUID_PATTERN, "Not an id."), "id");
const fieldParam = new ZodValidationPipe(
  z.string().regex(INTEGRATION_SECRET_FIELD_PATTERN, "Not a secret field."),
  "field",
);

function actorOf(principal: AdminPrincipal, request: Request): IntegrationActor {
  // `request.ip` is the socket address unless Express `trust proxy` is set (`TRUST_PROXY`).
  return { principal, clientAddress: request.ip ?? "unknown" };
}

/**
 * Thin HTTP layer of the integration store. Every route needs `integrations.manage` (owner only); the two changes also
 * ask for the owner's current password. No route returns a secret or makes a call to a provider.
 */
@AdminController("integrations", INTEGRATIONS_ADMIN_PERMISSIONS)
export class IntegrationsController {
  constructor(@Inject(IntegrationsService) private readonly integrations: IntegrationsService) {}

  @Get()
  @ApiOperation({
    summary: "List the installed providers that can hold credentials",
    description:
      "One entry per installed provider package that declares secrets, enabled or not. Each secret reports only whether it is set and where (`env`, `set`, `not_set`). Makes no call to a provider.",
  })
  @ApiZodResponse(200, integrationListResponseSchema, "The integrations and the current revision.")
  list(): Promise<IntegrationListResponse> {
    return this.integrations.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one integration" })
  @ApiParam(ID_PARAM)
  @ApiZodResponse(200, integrationDetailResponseSchema, "The integration.")
  @ApiProblemResponses(400, 404)
  get(@Param("id", idParam) id: string): Promise<IntegrationDetailResponse> {
    return this.integrations.get(id);
  }

  @Put(":id/secrets/:field")
  @ApiOperation({
    summary: "Store a provider credential",
    description:
      "Encrypts the value and stores it as a new candidate version, replacing an earlier candidate of the same credential. The value is never returned and, in this release, not yet used at runtime: providers still read the server environment. Asks for the owner's current password (wrong: `403`, `rule: current_password_incorrect`); limited per admin and per address, and answers `503` when the shared limits are unavailable. `409` rules: `integration_env_override`, `integration_storage_disabled`, `integration_revision_stale`, `integration_unavailable`.",
  })
  @ApiParam(ID_PARAM)
  @ApiParam(FIELD_PARAM)
  @ApiZodBody(putIntegrationSecretSchema)
  @ApiZodResponse(200, integrationDetailResponseSchema, "The integration after the change.")
  @ApiProblemResponses(400, 404, 409, 429, 503)
  putSecret(
    @Param("id", idParam) id: string,
    @Param("field", fieldParam) field: string,
    @Body(new ZodValidationPipe(putIntegrationSecretSchema)) body: PutIntegrationSecretBody,
    @CurrentAdmin() admin: AdminPrincipal,
    @Req() request: Request,
  ): Promise<IntegrationDetailResponse> {
    return this.integrations.putSecret(actorOf(admin, request), id, field, body);
  }

  @Post(":id/retire-secret")
  @HttpCode(200)
  @ApiOperation({
    summary: "Remove a stored provider credential",
    description:
      "Deletes the encrypted value of a candidate version; the version stays as a tombstone. Works without `SECRETS_ENCRYPTION_KEY`. Asks for the owner's current password like the save. `409`: `integration_revision_stale`, or `invalid_transition` (`rule: integration_version_not_retirable`).",
  })
  @ApiParam(ID_PARAM)
  @ApiZodBody(retireIntegrationSecretSchema)
  @ApiZodResponse(200, integrationDetailResponseSchema, "The integration after the change.")
  @ApiProblemResponses(400, 404, 409, 429, 503)
  retireSecret(
    @Param("id", idParam) id: string,
    @Body(new ZodValidationPipe(retireIntegrationSecretSchema)) body: RetireIntegrationSecretBody,
    @CurrentAdmin() admin: AdminPrincipal,
    @Req() request: Request,
  ): Promise<IntegrationDetailResponse> {
    return this.integrations.retireSecret(actorOf(admin, request), id, body);
  }
}
