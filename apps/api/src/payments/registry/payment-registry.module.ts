import { Module, type DynamicModule } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import type { LoadedPaymentProvider } from "./payment-provider-loader.js";
import {
  LOADED_PAYMENT_PROVIDER_CODES,
  PaymentProviderRegistry,
} from "./payment-provider-registry.js";

/**
 * Mounts exactly the loaded provider modules and the registry that finds their providers. With no provider loaded it
 * imports nothing but discovery and the registry reports an empty list: no routes, no tables, no outbound calls, and
 * `onlinePayment` is false. A code loaded twice (for example `PAYMENT_PROVIDERS_ENABLED=fake` plus a test provider) stops
 * the startup.
 */
@Module({})
export class PaymentRegistryModule {
  static register(providers: readonly LoadedPaymentProvider[]): DynamicModule {
    const codes = providers.map((provider) => provider.code);
    const duplicate = codes.find((code, index) => codes.indexOf(code) !== index);
    if (duplicate !== undefined) {
      throw new Error(`Payment provider "${duplicate}" is loaded twice.`);
    }
    return {
      module: PaymentRegistryModule,
      // Global: the config routes and, later, the payment service read the registry without importing it.
      global: true,
      imports: [DiscoveryModule, ...providers.map((provider) => provider.module)],
      providers: [
        { provide: LOADED_PAYMENT_PROVIDER_CODES, useValue: codes },
        PaymentProviderRegistry,
      ],
      exports: [PaymentProviderRegistry],
    };
  }
}
