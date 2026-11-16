import { Delete, Get, HttpCode, Inject, Param, Query } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiResponse } from "@nestjs/swagger";
import type { AdminPrincipal } from "../../auth/admin-authenticator.js";
import { AdminController } from "../../auth/admin-controller.decorator.js";
import { CurrentAdmin } from "../../auth/current-admin.js";
import { ApiPaginationQuery, ApiProblemResponses, ApiZodResponse } from "../../common/openapi.js";
import { type PaginationQuery } from "../../common/pagination.js";
import { uuidParam, ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { EMAIL_ADMIN_PERMISSIONS } from "../admin/email-admin-permissions.js";
import {
  emailSuppressionPageResponseSchema,
  listEmailSuppressionsQuerySchema,
  type EmailSuppressionPageResponse,
} from "./email-suppression.schemas.js";
import { EmailSuppressionService } from "./email-suppression.service.js";

@AdminController("email/suppressions", EMAIL_ADMIN_PERMISSIONS)
export class EmailSuppressionsController {
  constructor(
    @Inject(EmailSuppressionService) private readonly suppression: EmailSuppressionService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "List shared recipient suppressions, newest event first",
    description:
      "Full normalized and masked addresses under email.manage, matching message-list exposure. No recipient filter or separate reveal endpoint.",
  })
  @ApiPaginationQuery()
  @ApiZodResponse(200, emailSuppressionPageResponseSchema, "A bounded page of suppressions.")
  @ApiProblemResponses(400)
  list(
    @Query(new ZodValidationPipe(listEmailSuppressionsQuerySchema)) query: PaginationQuery,
  ): Promise<EmailSuppressionPageResponse> {
    return this.suppression.list(query);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({
    summary: "Remove one local suppression",
    description:
      "CSRF required. Removal and its IDs-only audit entry commit together; retry receipts remain. Does not resend mail or alter remote blocklists.",
  })
  @ApiParam({ name: "id", format: "uuid", description: "Opaque suppression entry ID." })
  @ApiResponse({ status: 204, description: "Removed. Empty body." })
  @ApiProblemResponses(400, 404)
  remove(
    @Param("id", uuidParam("id")) id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<void> {
    return this.suppression.remove(id, admin.userId);
  }
}
