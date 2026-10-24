import { Module, type DynamicModule } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import type { LoadedShippingProvider } from "./shipping-provider-loader.js";
import {
  LOADED_SHIPPING_PROVIDER_CODES,
  ShippingProviderRegistry,
} from "./shipping-provider-registry.js";

/**
 * Mounts exactly the loaded provider modules and the registry that finds their providers. With no provider loaded it
 * imports nothing but discovery and the registry reports an empty list: no routes, no tables, no outbound calls.
 */
@Module({})
export class ShippingRegistryModule {
  static register(providers: readonly LoadedShippingProvider[]): DynamicModule {
    return {
      module: ShippingRegistryModule,
      // Global: the admin settings API and the later store and shipment modules read the registry without importing it.
      global: true,
      imports: [DiscoveryModule, ...providers.map((provider) => provider.module)],
      providers: [
        { provide: LOADED_SHIPPING_PROVIDER_CODES, useValue: providers.map((p) => p.code) },
        ShippingProviderRegistry,
      ],
      exports: [ShippingProviderRegistry],
    };
  }
}
