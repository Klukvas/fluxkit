import { Global, Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { EmailWebhookController } from "../webhooks/email-webhook.controller.js";
import { EmailFallbackReadiness } from "../registry/email-fallback-readiness.js";
import { EmailSuppressionService } from "./email-suppression.service.js";
import { EmailSuppressionsController } from "./email-suppressions.controller.js";

/** Core safety gate remains active even with delivery disabled or webhook credentials absent. */
@Global()
@Module({
  imports: [DiscoveryModule],
  controllers: [EmailWebhookController, EmailSuppressionsController],
  providers: [EmailSuppressionService, EmailFallbackReadiness],
  exports: [EmailSuppressionService],
})
export class EmailSuppressionModule {}
