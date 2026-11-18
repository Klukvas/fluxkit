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
  emailRouteResponseSchema,
  integrationDetailResponseSchema,
  integrationListResponseSchema,
  integrationMutationSchema,
  putIntegrationSecretSchema,
  retireIntegrationSecretSchema,
  setEmailRouteSchema,
  type EmailRouteResponse,
  type IntegrationDetailResponse,
  type IntegrationListResponse,
  type IntegrationMutationBody,
  type PutIntegrationSecretBody,
  type RetireIntegrationSecretBody,
  type SetEmailRouteBody,
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
 * Thin HTTP layer of the integration store. Every route needs `integrations.manage` (owner only); every change also
 * asks for the owner's current password. No route returns a secret. Activating email is the only change that makes a
 * stored key usable, and only when `EMAIL_PROVIDER` is absent.
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

  @Put("email-route")
  @ApiOperation({
    summary: "Choose how stored Resend and Brevo share mail",
    description:
      "`equal` alternates new mail between Resend and Brevo. `resend` starts every message with Resend and waits out a cooldown instead of skipping to Brevo. A definite non-acceptance is tried on the other. Applies whenever both are in the send chain, including a chain set on the server. Asks for the owner's current password. `409`: `integration_revision_stale`.",
  })
  @ApiZodBody(setEmailRouteSchema)
  @ApiZodResponse(200, emailRouteResponseSchema, "The route mode after the change.")
  @ApiProblemResponses(400, 403, 409, 429, 503)
  setEmailRoute(
    @Body(new ZodValidationPipe(setEmailRouteSchema)) body: SetEmailRouteBody,
    @CurrentAdmin() admin: AdminPrincipal,
    @Req() request: Request,
  ): Promise<EmailRouteResponse> {
    return this.integrations.setEmailRoute(actorOf(admin, request), body);
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
      "Encrypts the value and stores it as a new candidate version, replacing an earlier candidate of the same credential. The value is never returned. It is used only after `activate`, and only when `EMAIL_PROVIDER` is absent. Asks for the owner's current password (wrong: `403`, `rule: current_password_incorrect`); limited per admin and per address, and answers `503` when the shared limits are unavailable. `409` rules: `integration_env_override`, `integration_storage_disabled`, `integration_revision_stale`, `integration_unavailable`.",
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

  @Post(":id/activate")
  @HttpCode(200)
  @ApiOperation({
    summary: "Activate a stored email credential",
    description:
      "Makes the stored outbound credential the one new mail uses, when `EMAIL_PROVIDER` is absent and `EMAIL_FROM` is set. Payment and shipping answer 409 `integration_runtime_not_ready`. Asks for the owner's current password. Other 409 rules: `integration_env_override`, `integration_storage_disabled`, `integration_sender_required`, `integration_route_unset`, `integration_not_activatable`, `integration_revision_stale`.",
  })
  @ApiParam(ID_PARAM)
  @ApiZodBody(integrationMutationSchema)
  @ApiZodResponse(200, integrationDetailResponseSchema, "The integration after activation.")
  @ApiProblemResponses(400, 403, 404, 409, 429, 503)
  activate(
    @Param("id", idParam) id: string,
    @Body(new ZodValidationPipe(integrationMutationSchema)) body: IntegrationMutationBody,
    @CurrentAdmin() admin: AdminPrincipal,
    @Req() request: Request,
  ): Promise<IntegrationDetailResponse> {
    return this.integrations.activate(actorOf(admin, request), id, body);
  }

  @Post(":id/disable")
  @HttpCode(200)
  @ApiOperation({
    summary: "Stop admitting new work for a stored credential",
    description:
      "Turns the integration off. Mail already bound to the version may finish; a revoked version may not. The pointer stays so that work can be recognized. Asks for the owner's current password. `409`: `integration_not_enabled`, `integration_revision_stale`.",
  })
  @ApiParam(ID_PARAM)
  @ApiZodBody(integrationMutationSchema)
  @ApiZodResponse(200, integrationDetailResponseSchema, "The integration after it was turned off.")
  @ApiProblemResponses(400, 403, 404, 409, 429, 503)
  disable(
    @Param("id", idParam) id: string,
    @Body(new ZodValidationPipe(integrationMutationSchema)) body: IntegrationMutationBody,
    @CurrentAdmin() admin: AdminPrincipal,
    @Req() request: Request,
  ): Promise<IntegrationDetailResponse> {
    return this.integrations.disable(actorOf(admin, request), id, body);
  }

  @Post(":id/revoke-secret")
  @HttpCode(200)
  @ApiOperation({
    summary: "Revoke a stored credential version",
    description:
      "Marks the version revoked. It can never be activated again, and a mail bound to it is not sent. If it was the selected version, the integration is turned off. The envelope is kept. Asks for the owner's current password. `409`: `integration_version_not_revocable`, `integration_revision_stale`.",
  })
  @ApiParam(ID_PARAM)
  @ApiZodBody(retireIntegrationSecretSchema)
  @ApiZodResponse(200, integrationDetailResponseSchema, "The integration after the revocation.")
  @ApiProblemResponses(400, 403, 404, 409, 429, 503)
  revokeSecret(
    @Param("id", idParam) id: string,
    @Body(new ZodValidationPipe(retireIntegrationSecretSchema)) body: RetireIntegrationSecretBody,
    @CurrentAdmin() admin: AdminPrincipal,
    @Req() request: Request,
  ): Promise<IntegrationDetailResponse> {
    return this.integrations.revokeSecret(actorOf(admin, request), id, body);
  }
}
