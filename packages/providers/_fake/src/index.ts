import { Module } from "@nestjs/common";
import { FakeShippingProvider } from "./fake-shipping-provider.js";

export {
  FAKE_ESTIMATE_MINOR_UNITS,
  FAKE_OPERATIONS,
  FAKE_PROVIDER_CODE,
  FakeShippingProvider,
  type FakeFailure,
  type FakeOperation,
} from "./fake-shipping-provider.js";

/**
 * Entry point read by the API's shipping provider loader (named export `providerModule`, ADR 0029 decision 8). It is only
 * mounted when SHIPPING_PROVIDERS_ENABLED contains "fake". Test-only: never enable it in a real shop.
 */
@Module({ providers: [FakeShippingProvider], exports: [FakeShippingProvider] })
export class FakeShippingProviderModule {}

export const providerModule = FakeShippingProviderModule;
