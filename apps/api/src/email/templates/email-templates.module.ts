import { Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { AdminTestEmailTemplate } from "./admin-test.template.js";
import { PasswordChangedEmailTemplate } from "./customer-password-changed.template.js";
import { PasswordResetEmailTemplate } from "./customer-password-reset.template.js";
import { VerifyEmailEmailTemplate } from "./customer-verify-email.template.js";
import { EmailTemplateRegistry } from "./email-template-registry.js";
import { OrderCancelledEmailTemplate } from "./order-cancelled.template.js";
import { OrderExpiredEmailTemplate } from "./order-expired.template.js";
import { OrderPaidEmailTemplate } from "./order-paid.template.js";
import { OrderPlacedEmailTemplate } from "./order-placed.template.js";
import { ShipmentCreatedEmailTemplate } from "./shipment-created.template.js";

/**
 * The built-in mail templates and the registry that discovers them and every template a feature registers (ADR 0031
 * decision 14). Rendering needs no database and no provider, so the registry works with `EMAIL_PROVIDER=none` too (the
 * admin preview of plan step 9).
 */
@Module({
  imports: [DiscoveryModule],
  providers: [
    AdminTestEmailTemplate,
    PasswordResetEmailTemplate,
    PasswordChangedEmailTemplate,
    VerifyEmailEmailTemplate,
    OrderPlacedEmailTemplate,
    OrderPaidEmailTemplate,
    OrderCancelledEmailTemplate,
    OrderExpiredEmailTemplate,
    ShipmentCreatedEmailTemplate,
    EmailTemplateRegistry,
  ],
  exports: [EmailTemplateRegistry],
})
export class EmailTemplatesModule {}
