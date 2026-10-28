import { Module } from "@nestjs/common";
import { FakePaymentProvider } from "./fake-payment-provider.js";

export {
  FAKE_PAYMENT_PAGE_ORIGIN,
  FAKE_PAYMENT_PROVIDER_CODE,
  FakePaymentProvider,
  type FakeInvoice,
  type FakePaymentFailure,
  type FakePaymentOperation,
  type FakePaymentProviderOptions,
  type FakePaymentRequest,
  type FakeRefundRecord,
} from "./fake-payment-provider.js";
export {
  FAKE_PAYMENT_SIGNATURE_HEADER,
  FAKE_PAYMENT_WEBHOOK_KEY,
  fakeWebhookInput,
  signFakeWebhook,
} from "./webhook.js";

/**
 * Entry point read by the API's payment provider loader (named export `providerModule`, ADR 0032 decision 3). It is only
 * mounted when `PAYMENT_PROVIDERS_ENABLED` names `fake`. Test-only: never enable it in a real shop. It reads no
 * environment variable: the e2e hooks that need a second process arrive with the e2e step.
 */
@Module({
  providers: [{ provide: FakePaymentProvider, useFactory: () => new FakePaymentProvider() }],
  exports: [FakePaymentProvider],
})
export class FakePaymentProviderModule {}

export const providerModule = FakePaymentProviderModule;
