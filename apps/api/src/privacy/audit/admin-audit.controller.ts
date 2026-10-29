import { Get, Inject, Query } from "@nestjs/common";
import { ApiOperation, ApiQuery } from "@nestjs/swagger";
import { ADMIN_AUDIT_ACTIONS, ADMIN_AUDIT_TARGET_KINDS } from "@fluxkit/core";
import { AdminController } from "../../auth/admin-controller.decorator.js";
import { RequirePermission } from "../../auth/route-access.js";
import { ApiPaginationQuery, ApiProblemResponses, ApiZodResponse } from "../../common/openapi.js";
import { pageSchema, type Page } from "../../common/pagination.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import {
  auditEventSchema,
  listAuditEventsQuerySchema,
  type AuditEventView,
  type ListAuditEventsQuery,
} from "./admin-audit.schemas.js";
import { AdminAuditService } from "./admin-audit.service.js";

/**
 * The admin audit log (ADR 0033 decision 9): read only, owner only (`users.manage`, declared once on the controller).
 * There is no write route: events are written by the services they audit, in the same transaction.
 */
@AdminController("audit-events")
@RequirePermission("users.manage")
export class AdminAuditController {
  constructor(@Inject(AdminAuditService) private readonly audit: AdminAuditService) {}

  @Get()
  @ApiOperation({
    summary: "List admin audit events, newest first",
    description:
      "What admins did to customer accounts, admin users and privacy requests. Codes and ids only, never personal data.",
  })
  @ApiPaginationQuery()
  @ApiQuery({
    name: "action",
    required: false,
    schema: { type: "string", enum: [...ADMIN_AUDIT_ACTIONS] },
  })
  @ApiQuery({ name: "adminUserId", required: false, schema: { type: "string", format: "uuid" } })
  @ApiQuery({
    name: "targetKind",
    required: false,
    schema: { type: "string", enum: [...ADMIN_AUDIT_TARGET_KINDS] },
  })
  @ApiQuery({ name: "targetId", required: false, schema: { type: "string", format: "uuid" } })
  @ApiQuery({
    name: "from",
    required: false,
    description: "Inclusive; ISO 8601 with `Z` or an offset.",
    schema: { type: "string", format: "date-time" },
  })
  @ApiQuery({
    name: "to",
    required: false,
    description: "Exclusive; ISO 8601 with `Z` or an offset.",
    schema: { type: "string", format: "date-time" },
  })
  @ApiZodResponse(200, pageSchema(auditEventSchema), "A page of audit events.")
  @ApiProblemResponses(400)
  list(
    @Query(new ZodValidationPipe(listAuditEventsQuerySchema)) query: ListAuditEventsQuery,
  ): Promise<Page<AuditEventView>> {
    return this.audit.list(query);
  }
}
