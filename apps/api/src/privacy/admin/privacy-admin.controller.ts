import { Body, Get, HttpCode, Inject, Param, Post, Query, Res } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiQuery } from "@nestjs/swagger";
import { PRIVACY_REQUEST_STATUSES, type PersonalDataExport } from "@fluxkit/core";
import type { Response } from "express";
import type { AdminPrincipal } from "../../auth/admin-authenticator.js";
import { AdminController } from "../../auth/admin-controller.decorator.js";
import { CurrentAdmin } from "../../auth/current-admin.js";
import { RequirePermission } from "../../auth/route-access.js";
import {
  ApiPaginationQuery,
  ApiProblemResponses,
  ApiZodBody,
  ApiZodResponse,
} from "../../common/openapi.js";
import { pageSchema, type Page } from "../../common/pagination.js";
import { uuidParam, ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { RateLimit } from "../../rate-limit/rate-limit.decorator.js";
import { personalDataExportSchema, setExportHeaders } from "../export/export-response.js";
import {
  createRequestBodySchema,
  eraseBodySchema,
  erasePreviewBodySchema,
  erasePreviewSchema,
  exportBodySchema,
  rejectBodySchema,
  listRequestsQuerySchema,
  lookupBodySchema,
  lookupResultSchema,
  privacyRequestSchema,
  type CreateRequestBody,
  type EraseBody,
  type ErasePreviewBody,
  type ErasePreviewView,
  type ExportBody,
  type RejectBody,
  type ListRequestsQuery,
  type LookupBody,
  type LookupResult,
  type PrivacyRequestView,
} from "./privacy-admin.schemas.js";
import { PrivacyAdminService } from "./privacy-admin.service.js";

const ID_PARAM = { name: "id", format: "uuid", description: "Privacy request id." };

/**
 * The Privacy area (ADR 0033 decisions 9 and 10): every route needs `privacy.manage` (owner only), declared once on the
 * controller. Emails travel in POST bodies only, so they never reach a URL or a proxy log.
 */
@AdminController("privacy")
@RequirePermission("privacy.manage")
export class PrivacyAdminController {
  constructor(@Inject(PrivacyAdminService) private readonly privacy: PrivacyAdminService) {}

  @Post("lookup")
  @HttpCode(200)
  @ApiOperation({
    summary: "Find what the shop holds for an email",
    description:
      "The account with this email, its guest orders, the number of mails and the open privacy requests. Audited (`privacy.lookup`). The email is in the body, never in the URL.",
  })
  @ApiZodBody(lookupBodySchema)
  @ApiZodResponse(200, lookupResultSchema, "What was found.")
  @ApiProblemResponses(400)
  lookup(
    @Body(new ZodValidationPipe(lookupBodySchema)) body: LookupBody,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<LookupResult> {
    return this.privacy.lookup(body.email, admin.userId);
  }

  @Get("requests")
  @ApiOperation({ summary: "List privacy requests: open ones by due date first, then closed ones" })
  @ApiPaginationQuery()
  @ApiQuery({
    name: "status",
    required: false,
    schema: { type: "string", enum: [...PRIVACY_REQUEST_STATUSES] },
  })
  @ApiZodResponse(200, pageSchema(privacyRequestSchema), "A page of privacy requests.")
  @ApiProblemResponses(400)
  list(
    @Query(new ZodValidationPipe(listRequestsQuerySchema)) query: ListRequestsQuery,
  ): Promise<Page<PrivacyRequestView>> {
    return this.privacy.list(query);
  }

  @Post("requests")
  @ApiOperation({
    summary: "Record a privacy request (export or erasure) of an account or an email",
    description:
      "Due 30 days after it is received. The email of an email subject is stored only as an HMAC. Audited (`privacy.request_changed`).",
  })
  @ApiZodBody(createRequestBodySchema)
  @ApiZodResponse(201, privacyRequestSchema, "The new request. `Location` points to it.")
  @ApiProblemResponses(400, 404)
  async create(
    @Body(new ZodValidationPipe(createRequestBodySchema)) body: CreateRequestBody,
    @CurrentAdmin() admin: AdminPrincipal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PrivacyRequestView> {
    const created = await this.privacy.create(body, admin.userId);
    response.setHeader("Location", `/admin/privacy/requests/${created.id}`);
    return created;
  }

  @Get("requests/:id")
  @ApiOperation({ summary: "Get one privacy request" })
  @ApiParam(ID_PARAM)
  @ApiZodResponse(200, privacyRequestSchema, "The request.")
  @ApiProblemResponses(400, 404)
  get(@Param("id", uuidParam("id")) id: string): Promise<PrivacyRequestView> {
    return this.privacy.get(id);
  }

  @Post("requests/:id/export")
  @HttpCode(200)
  @RateLimit("privacyExport")
  @ApiOperation({
    summary: "Download the personal data of the request's subject",
    description:
      "JSON document `fluxkit.personal-data-export/v1` as an attachment. An email subject needs its email again in the body (only an HMAC is stored). Completes an export request; moves an erasure request to `in_progress`. Audited (`privacy.exported`).",
  })
  @ApiParam(ID_PARAM)
  @ApiZodBody(exportBodySchema)
  @ApiZodResponse(
    200,
    personalDataExportSchema,
    "The document (`Content-Disposition: attachment`).",
  )
  @ApiProblemResponses(400, 404, 409, 429)
  async exportRequest(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(exportBodySchema)) body: ExportBody,
    @CurrentAdmin() admin: AdminPrincipal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PersonalDataExport> {
    const document = await this.privacy.exportRequest(id, body, admin.userId);
    setExportHeaders(response, document);
    return document;
  }

  @Post("requests/:id/erase-preview")
  @HttpCode(200)
  @ApiOperation({
    summary: "What an erasure of the request's subject would do now",
    description:
      "Counts and blockers; nothing changes. An email subject needs its email again in the body.",
  })
  @ApiParam(ID_PARAM)
  @ApiZodBody(erasePreviewBodySchema)
  @ApiZodResponse(200, erasePreviewSchema, "Counts and blockers.")
  @ApiProblemResponses(400, 404, 409)
  erasePreview(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(erasePreviewBodySchema)) body: ErasePreviewBody,
  ): Promise<ErasePreviewView> {
    return this.privacy.erasePreview(id, body);
  }

  @Post("requests/:id/erase")
  @HttpCode(200)
  @ApiOperation({
    summary: "Erase the request's subject (irreversible)",
    description:
      "Deletes the account (if any) and the mails, anonymises the contact fields of every order; orders, payments, refunds and shipments stay. `confirm: true` is required. Refused with `409 rule_violation` `erasure_blocked` (members `reasons`, `blockers`) while anything is in progress. Idempotent: a completed erasure request answers its stored result. Audited (`privacy.erased`).",
  })
  @ApiParam(ID_PARAM)
  @ApiZodBody(eraseBodySchema)
  @ApiZodResponse(200, privacyRequestSchema, "The completed request with its result.")
  @ApiProblemResponses(400, 404, 409)
  erase(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(eraseBodySchema)) body: EraseBody,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<PrivacyRequestView> {
    return this.privacy.erase(id, body, admin.userId);
  }

  @Post("requests/:id/reject")
  @HttpCode(200)
  @ApiOperation({
    summary: "Reject an open request with a reason code",
    description: "Audited (`privacy.request_changed`). A closed request is `409 request_closed`.",
  })
  @ApiParam(ID_PARAM)
  @ApiZodBody(rejectBodySchema)
  @ApiZodResponse(200, privacyRequestSchema, "The rejected request.")
  @ApiProblemResponses(400, 404, 409)
  reject(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(rejectBodySchema)) body: RejectBody,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<PrivacyRequestView> {
    return this.privacy.reject(id, body, admin.userId);
  }
}
