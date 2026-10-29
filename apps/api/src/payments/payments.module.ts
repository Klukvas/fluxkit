import { Global, Module, type DynamicModule } from "@nestjs/common";
import { StoreModule } from "../catalog/store/store.module.js";
import {
  AdminOrderPaymentsController,
  AdminPaymentsController,
} from "./admin/admin-payments.controller.js";
import { AdminPaymentsService } from "./admin/admin-payments.service.js";
import { PaymentAttemptsModule } from "./attempts/payment-attempts.module.js";
import { PaymentCreateService } from "./payment-create.service.js";
import { PaymentFactsService } from "./payment-facts.service.js";
import { PaymentReadsService } from "./payment-reads.service.js";
import { PaymentReconcileService } from "./payment-reconcile.service.js";
import { PaymentRefundsService } from "./payment-refunds.service.js";
import { PAYMENTS_CONFIG, type PaymentsConfig } from "./payments-config.js";
import { StorePaymentViews } from "./store/store-payment-views.js";
import {
  AccountPaymentsController,
  StorePaymentsController,
} from "./store/store-payments.controller.js";
import { StorePaymentsService } from "./store/store-payments.service.js";
import { PaymentWebhookController } from "./webhook/payment-webhook.controller.js";

/**
 * Online payments (ADR 0032, payments plan steps 5 and 8): the create flow, the application of verified provider facts
 * (`markPaidIn`), refunds, the reconcile work of job 11, on-demand status reads, the webhook route
 * `POST /webhooks/payments/{provider}`, the store payment routes (`/store/orders/payments*`,
 * `/store/account/orders/{number}/payments*`) and the admin payment routes (`/admin/orders/{id}/payments*`,
 * `/admin/payments*`). Core, no feature flag: with no provider enabled (`PAYMENT_PROVIDERS_ENABLED` empty) the webhook
 * route answers 404, a create is `409 payment_not_available`, the admin reads still work and job 11 does nothing.
 * Global because the scheduler's job 11 and the store order views (`StorePaymentViews`) use its services. Needs the globals of `PaymentRegistryModule`, `OrdersModule`, `AuthModule`
 * (clock), `CommonModule` (locales), `RateLimitModule` and the database.
 */
@Global()
@Module({})
export class PaymentsModule {
  static register(config: PaymentsConfig): DynamicModule {
    return {
      module: PaymentsModule,
      imports: [PaymentAttemptsModule, StoreModule],
      controllers: [
        PaymentWebhookController,
        StorePaymentsController,
        AccountPaymentsController,
        AdminOrderPaymentsController,
        AdminPaymentsController,
      ],
      providers: [
        { provide: PAYMENTS_CONFIG, useValue: config },
        PaymentFactsService,
        PaymentCreateService,
        PaymentRefundsService,
        PaymentReconcileService,
        PaymentReadsService,
        StorePaymentViews,
        StorePaymentsService,
        AdminPaymentsService,
      ],
      exports: [
        PAYMENTS_CONFIG,
        PaymentFactsService,
        PaymentCreateService,
        PaymentRefundsService,
        PaymentReconcileService,
        PaymentReadsService,
        StorePaymentViews,
      ],
    };
  }
}
