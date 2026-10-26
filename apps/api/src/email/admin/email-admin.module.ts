import { Module } from "@nestjs/common";
import { EmailAdminRepository } from "./email-admin.repository.js";
import { EmailAdminService } from "./email-admin.service.js";
import { EmailMessagesController } from "./email-messages.controller.js";
import { EmailTemplatesAdminController } from "./email-templates.controller.js";

/**
 * The admin email API (ADR 0031 decision 15): status, test send, the outbox with resend and cancel, the templates and their
 * preview, all behind `email.manage`. Uses the globals of the outbox, the provider registry, the database and the
 * clock; adds no table and no job.
 */
@Module({
  controllers: [EmailMessagesController, EmailTemplatesAdminController],
  providers: [EmailAdminService, EmailAdminRepository],
})
export class EmailAdminModule {}
