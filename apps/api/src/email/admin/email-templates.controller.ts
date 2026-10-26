import { Get, Inject, Param, Query, Res } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiQuery } from "@nestjs/swagger";
import { EMAIL_TEMPLATE_KEY_PATTERN } from "@fluxkit/core";
import type { Response } from "express";
import { AdminController } from "../../auth/admin-controller.decorator.js";
import { ApiProblemResponses, ApiZodResponse } from "../../common/openapi.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { EMAIL_ADMIN_PERMISSIONS } from "./email-admin-permissions.js";
import {
  emailPreviewResponseSchema,
  emailTemplateListResponseSchema,
  previewQuerySchema,
  templateKeyParamSchema,
  type EmailPreviewResponse,
  type EmailTemplateListResponse,
  type PreviewQuery,
} from "./email-admin.schemas.js";
import { EmailAdminService } from "./email-admin.service.js";

/**
 * The CSP of a preview answer. The body is JSON, so a browser never renders it, but should something open the response
 * as a document anyway nothing may load or run (the admin shows the HTML part only in a `sandbox=""` iframe).
 */
export const PREVIEW_CONTENT_SECURITY_POLICY = "default-src 'none'; sandbox";

/** The registered mail templates and their preview. Every route needs `email.manage` (the controller's default pair). */
@AdminController("email", EMAIL_ADMIN_PERMISSIONS)
export class EmailTemplatesAdminController {
  constructor(@Inject(EmailAdminService) private readonly email: EmailAdminService) {}

  @Get("templates")
  @ApiOperation({
    summary: "List the registered mail templates",
    description:
      "Key, version, category and the locales with their own texts, sorted by key. Works with `EMAIL_PROVIDER=none`.",
  })
  @ApiZodResponse(200, emailTemplateListResponseSchema, "The templates.")
  list(): EmailTemplateListResponse {
    return this.email.listTemplates();
  }

  @Get("templates/:key/preview")
  @ApiOperation({
    summary: "Preview a template with its sample variables",
    description:
      "Renders the template's own sample variables (never real customer data, no database read, nothing sent) with placeholder links. `html` is a JSON string: show it only in a sandboxed `iframe srcdoc`. The answer is `no-store`, `nosniff` and carries a CSP that allows nothing. Works with `EMAIL_PROVIDER=none`.",
  })
  @ApiParam({
    name: "key",
    description: "A registered template key, for example `order.placed`.",
    schema: { type: "string", pattern: EMAIL_TEMPLATE_KEY_PATTERN.source },
  })
  @ApiQuery({
    name: "locale",
    required: false,
    description: "One of `LOCALES`. Default: `DEFAULT_LOCALE`.",
    schema: { type: "string" },
  })
  @ApiZodResponse(200, emailPreviewResponseSchema, "The rendered preview.")
  @ApiProblemResponses(400, 404)
  preview(
    @Param("key", new ZodValidationPipe(templateKeyParamSchema, "key")) key: string,
    @Query(new ZodValidationPipe(previewQuerySchema)) query: PreviewQuery,
    @Res({ passthrough: true }) response: Response,
  ): EmailPreviewResponse {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", PREVIEW_CONTENT_SECURITY_POLICY);
    return this.email.preview(key, query.locale);
  }
}
