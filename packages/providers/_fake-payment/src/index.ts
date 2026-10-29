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
 * `FAKE_PAYMENT_ADOPT_WEBHOOKS` (test-only, optional): `true` makes a verified webhook move the fake's own invoice to the
 * state it announces, so an e2e suite whose API runs in another process can pay an invoice by POSTing the signed webhook
 * the provider would send (README, "Driving it from another process"). Unset or `false`: off. Anything else stops the start.
 */
export function parseAdoptWebhooks(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "false") {
    return false;
  }
  if (value === "true") {
    return true;
  }
  throw new Error("FAKE_PAYMENT_ADOPT_WEBHOOKS must be true or false (the value is not shown).");
}

/**
 * Entry point read by the API's payment provider loader (named export `providerModule`, ADR 0032 decision 3). It is only
 * mounted when `PAYMENT_PROVIDERS_ENABLED` names `fake`. Test-only: never enable it in a real shop. It reads one optional
 * variable, `FAKE_PAYMENT_ADOPT_WEBHOOKS`, for e2e suites that run the API in another process.
 */
@Module({
  providers: [
    {
      provide: FakePaymentProvider,
      useFactory: () =>
        new FakePaymentProvider({
          adoptVerifiedWebhooks: parseAdoptWebhooks(process.env["FAKE_PAYMENT_ADOPT_WEBHOOKS"]),
        }),
    },
  ],
  exports: [FakePaymentProvider],
})
export class FakePaymentProviderModule {}

export const providerModule = FakePaymentProviderModule;
