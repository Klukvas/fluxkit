import { Module, type DynamicModule } from "@nestjs/common";
import { EmailTemplatesModule } from "../templates/index.js";
import { EMAIL_DELIVERY_CONFIG, type EmailDeliveryConfig } from "./email-delivery-config.js";
import { EMAIL_LINK_SOURCE, StorefrontEmailLinks } from "./email-links.js";
import { EmailMessageChanges } from "./email-message-changes.js";
import { EmailOutboxRepository } from "./email-outbox.repository.js";
import { EmailOutbox } from "./email-outbox.service.js";
import { EMAIL_SEND_PACER, EmailSender } from "./email-sender.js";
import { SendPacer } from "./send-pacer.js";

/**
 * The mail outbox (ADR 0031 decisions 5 to 8): enqueue (`EmailOutbox`), the one writer (`EmailMessageChanges`), the
 * sender with its per-process pacing (`EmailSender`) and the templates. Core, no flag: with `EMAIL_PROVIDER=none` the
 * enqueue writes nothing and the sender claims nothing. Global, so the jobs and (later) the auth flows, event handlers
 * and admin routes use it without importing it. Needs the globals of the database, `AuthModule` (clock),
 * `CommonModule` (locales) and `EmailRegistryModule` (the provider).
 *
 * A loaded provider without `EMAIL_FROM` or `STOREFRONT_PUBLIC_URL` stops the startup (`loadEnv` already refuses it; this
 * guards callers that build the application without it).
 */
@Module({})
export class EmailOutboxModule {
  static register(config: EmailDeliveryConfig, providerLoaded: boolean): DynamicModule {
    if (providerLoaded && config.from === null) {
      throw new Error("An email provider is loaded but EMAIL_FROM is not set.");
    }
    if (providerLoaded && config.storefrontPublicUrl === null) {
      throw new Error("An email provider is loaded but STOREFRONT_PUBLIC_URL is not set.");
    }
    return {
      module: EmailOutboxModule,
      global: true,
      imports: [EmailTemplatesModule],
      providers: [
        { provide: EMAIL_DELIVERY_CONFIG, useValue: config },
        {
          provide: EMAIL_SEND_PACER,
          useFactory: () => new SendPacer(config.tuning.sendsPerSecond),
        },
        { provide: EMAIL_LINK_SOURCE, useClass: StorefrontEmailLinks },
        EmailOutboxRepository,
        EmailMessageChanges,
        EmailOutbox,
        EmailSender,
      ],
      exports: [
        EMAIL_DELIVERY_CONFIG,
        EmailTemplatesModule,
        EmailOutboxRepository,
        EmailMessageChanges,
        EmailOutbox,
        EmailSender,
      ],
    };
  }
}
