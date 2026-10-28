import { Global, Module, type DynamicModule } from "@nestjs/common";
import { PaymentAttemptsModule } from "./attempts/payment-attempts.module.js";
import { PaymentCreateService } from "./payment-create.service.js";
import { PaymentFactsService } from "./payment-facts.service.js";
import { PAYMENTS_CONFIG, type PaymentsConfig } from "./payments-config.js";

/**
 * Online payments (ADR 0032, payments plan step 5): the create flow, the application of verified provider facts
 * (`markPaidIn`), refunds, the reconcile work of job 11 and the webhook route `POST /webhooks/payments/{provider}`.
 * Core, no feature flag: with no provider enabled (`PAYMENT_PROVIDERS_ENABLED` empty) the webhook route answers 404,
 * no attempt can be created and job 11 does nothing. Global because the scheduler's job 11 and the store and admin
 * routes of plan step 8 use its services. Needs the globals of `PaymentRegistryModule`, `OrdersModule`, `AuthModule`
 * (clock), `CommonModule` (locales), `RateLimitModule` and the database.
 */
@Global()
@Module({})
export class PaymentsModule {
  static register(config: PaymentsConfig): DynamicModule {
    return {
      module: PaymentsModule,
      imports: [PaymentAttemptsModule],
      providers: [
        { provide: PAYMENTS_CONFIG, useValue: config },
        PaymentFactsService,
        PaymentCreateService,
      ],
      exports: [PAYMENTS_CONFIG, PaymentFactsService, PaymentCreateService],
    };
  }
}
