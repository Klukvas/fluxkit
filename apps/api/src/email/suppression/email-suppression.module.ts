import { Global, Module } from "@nestjs/common";
import { EmailWebhookController } from "../webhooks/email-webhook.controller.js";
import { EmailSuppressionService } from "./email-suppression.service.js";
import { EmailSuppressionsController } from "./email-suppressions.controller.js";

/** Core safety gate remains active even with delivery disabled or webhook credentials absent. */
@Global()
@Module({
  controllers: [EmailWebhookController, EmailSuppressionsController],
  providers: [EmailSuppressionService],
  exports: [EmailSuppressionService],
})
export class EmailSuppressionModule {}
