import { Global, Module } from "@nestjs/common";
import { AdminAuditController } from "./admin-audit.controller.js";
import { AdminAuditService } from "./admin-audit.service.js";
import { AdminAuditWriter } from "./admin-audit.writer.js";

/**
 * The admin audit log (ADR 0033 decision 9). Global, so the services it audits (customers, admin users, privacy) inject
 * `AdminAuditWriter` without importing this module and without an import cycle. Core, no feature flag.
 */
@Global()
@Module({
  controllers: [AdminAuditController],
  providers: [AdminAuditWriter, AdminAuditService],
  exports: [AdminAuditWriter],
})
export class AdminAuditModule {}
