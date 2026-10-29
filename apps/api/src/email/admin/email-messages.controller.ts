import { Body, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiQuery } from "@nestjs/swagger";
import { EMAIL_MESSAGE_STATUSES, EMAIL_TEMPLATE_KEY_PATTERN } from "@fluxkit/core";
import type { AdminPrincipal } from "../../auth/admin-authenticator.js";
import { AdminController } from "../../auth/admin-controller.decorator.js";
import { CurrentAdmin } from "../../auth/current-admin.js";
import {
  ApiPaginationQuery,
  ApiProblemResponses,
  ApiZodBody,
  ApiZodResponse,
} from "../../common/openapi.js";
import { uuidParam, ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { RateLimit } from "../../rate-limit/rate-limit.decorator.js";
import { EMAIL_ADMIN_PERMISSIONS } from "./email-admin-permissions.js";
import {
  emailMessageDetailResponseSchema,
  emailMessageIdResponseSchema,
  emailMessagePageResponseSchema,
  emailMessageResponseSchema,
  emailStatusResponseSchema,
  listEmailMessagesQuerySchema,
  RECIPIENT_FILTER_MAX_LENGTH,
  sendTestEmailSchema,
  type EmailMessageDetailResponse,
  type EmailMessageIdResponse,
  type EmailMessagePageResponse,
  type EmailMessageResponse,
  type EmailStatusResponse,
  type ListEmailMessagesQuery,
  type SendTestEmailBody,
} from "./email-admin.schemas.js";
import { EmailAdminService } from "./email-admin.service.js";

const ID_PARAM = { name: "id", format: "uuid", description: "Email message (outbox row) id." };

/**
 * Thin HTTP layer of the mail status, test send and outbox (ADR 0031 decision 15). Every route needs `email.manage`,
 * reads included: the outbox shows recipient addresses. Declared once as the default pair of the controller, so a route
 * added later is protected the same way.
 */
@AdminController("email", EMAIL_ADMIN_PERMISSIONS)
export class EmailMessagesController {
  constructor(@Inject(EmailAdminService) private readonly email: EmailAdminService) {}

  @Get("status")
  @ApiOperation({
    summary: "Mail delivery status",
    description:
      "Works with `EMAIL_PROVIDER=none` too (`configured: false`). Counts of the last 24 hours by status, the open queue, the oldest pending mail and the most common error codes. Never the provider key.",
  })
  @ApiZodResponse(200, emailStatusResponseSchema, "The status.")
  status(): Promise<EmailStatusResponse> {
    return this.email.status();
  }

  @Post("test")
  @HttpCode(202)
  @RateLimit("emailTest")
  @ApiOperation({
    summary: "Send a test mail to the signed-in admin's own address",
    description:
      "Queues the `admin.test` mail through the configured provider and starts the first attempt after the answer; follow it in the list. The recipient is the caller's own email, there is no address in the body. 5 per hour per admin user. 409 `rule_violation` `email_not_configured` without a provider, `address_undeliverable` when the admin's address cannot go into a mail header.",
  })
  @ApiZodBody(sendTestEmailSchema)
  @ApiZodResponse(202, emailMessageIdResponseSchema, "The queued test mail.")
  @ApiProblemResponses(400, 409, 429)
  sendTest(
    @Body(new ZodValidationPipe(sendTestEmailSchema)) body: SendTestEmailBody,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<EmailMessageIdResponse> {
    return this.email.sendTest(admin, body);
  }

  @Get("messages")
  @ApiOperation({
    summary: "List mail messages, newest first",
    description:
      "The outbox with the recipient address (personal data, never logged) and the delivery codes; no rendered body exists. Filters combine with AND. `recipient` is a case-insensitive substring of the address. `createdFrom` is inclusive, `createdTo` exclusive.",
  })
  @ApiPaginationQuery()
  @ApiQuery({
    name: "status",
    required: false,
    schema: { type: "string", enum: [...EMAIL_MESSAGE_STATUSES] },
  })
  @ApiQuery({
    name: "template",
    required: false,
    schema: { type: "string", pattern: EMAIL_TEMPLATE_KEY_PATTERN.source },
  })
  @ApiQuery({
    name: "recipient",
    required: false,
    schema: { type: "string", minLength: 1, maxLength: RECIPIENT_FILTER_MAX_LENGTH },
  })
  @ApiQuery({ name: "orderId", required: false, schema: { type: "string", format: "uuid" } })
  @ApiQuery({ name: "customerId", required: false, schema: { type: "string", format: "uuid" } })
  @ApiQuery({
    name: "createdFrom",
    required: false,
    schema: { type: "string", format: "date-time" },
  })
  @ApiQuery({ name: "createdTo", required: false, schema: { type: "string", format: "date-time" } })
  @ApiZodResponse(200, emailMessagePageResponseSchema, "A page of messages.")
  @ApiProblemResponses(400)
  list(
    @Query(new ZodValidationPipe(listEmailMessagesQuerySchema)) query: ListEmailMessagesQuery,
  ): Promise<EmailMessagePageResponse> {
    return this.email.list(query);
  }

  @Get("messages/:id")
  @ApiOperation({
    summary: "Get one mail message",
    description:
      "The journal fields, codes and the deadline, and the frozen template variables redacted (`[redacted]`: every value of a `customer.*` mail, any value under a key that names a token, secret, password or link).",
  })
  @ApiParam(ID_PARAM)
  @ApiZodResponse(200, emailMessageDetailResponseSchema, "The message.")
  @ApiProblemResponses(400, 404)
  get(@Param("id", uuidParam("id")) id: string): Promise<EmailMessageDetailResponse> {
    return this.email.get(id);
  }

  @Post("messages/:id/resend")
  @HttpCode(202)
  @RateLimit("emailResend")
  @ApiOperation({
    summary: "Send a message again as a new message",
    description:
      "Creates a NEW row (`resendOf` the original, a fresh id and idempotency key) with the same template, locale and variables and the CURRENT template version, and starts its first attempt after the answer. The original is not changed. 409 `rule_violation`: `message_open` (the original is pending or sending), `not_resendable` (an account mail of a customer: the person asks again), `template_unavailable`, `variables_invalid` (the stored variables fail the current template), `email_not_configured`, `address_undeliverable`. A resent `admin.test` goes to the address of the admin who resends it. 30 per hour per admin user (429 with `Retry-After`).",
  })
  @ApiParam(ID_PARAM)
  @ApiZodResponse(202, emailMessageIdResponseSchema, "The new message.")
  @ApiProblemResponses(400, 404, 409, 429)
  resend(
    @Param("id", uuidParam("id")) id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<EmailMessageIdResponse> {
    return this.email.resend(admin, id);
  }

  @Post("messages/:id/cancel")
  @HttpCode(200)
  @ApiOperation({
    summary: "Cancel a pending message",
    description:
      "`pending` -> `cancelled`, decided under the row lock: of two cancels, or of a cancel and the sender's claim, exactly one wins. Any other status answers 409 `invalid_transition` (a message being sent or already final cannot be cancelled). Works with `EMAIL_PROVIDER=none` too.",
  })
  @ApiParam(ID_PARAM)
  @ApiZodResponse(200, emailMessageResponseSchema, "The cancelled message.")
  @ApiProblemResponses(400, 404, 409)
  cancel(@Param("id", uuidParam("id")) id: string): Promise<EmailMessageResponse> {
    return this.email.cancel(id);
  }
}
