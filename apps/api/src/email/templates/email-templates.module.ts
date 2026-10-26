import { Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { AdminTestEmailTemplate } from "./admin-test.template.js";
import { EmailTemplateRegistry } from "./email-template-registry.js";

/**
 * The built-in mail templates and the registry that discovers them and every template a feature registers (ADR 0031
 * decision 14). Rendering needs no database and no provider, so the registry works with `EMAIL_PROVIDER=none` too (the
 * admin preview of plan step 9).
 */
@Module({
  imports: [DiscoveryModule],
  providers: [AdminTestEmailTemplate, EmailTemplateRegistry],
  exports: [EmailTemplateRegistry],
})
export class EmailTemplatesModule {}
