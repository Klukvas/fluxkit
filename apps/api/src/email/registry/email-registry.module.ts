import { Module, type DynamicModule } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import type { LoadedEmailProvider } from "./email-provider-loader.js";
import {
  EMAIL_ROUTE_DELEGATED,
  EmailProviderRegistry,
  LOADED_EMAIL_PROVIDER_CODE,
} from "./email-provider-registry.js";

/** Mounts the ordered primary/fallback modules. Duplicate configured codes are refused before discovery. */
@Module({})
export class EmailRegistryModule {
  static register(providers: readonly LoadedEmailProvider[], delegated = false): DynamicModule {
    if (new Set(providers.map((provider) => provider.code)).size !== providers.length) {
      throw new Error("Email provider codes must be distinct in the ordered provider chain.");
    }
    return {
      module: EmailRegistryModule,
      // Global: the config routes and, later, the sender and the auth flows read the registry without importing it.
      global: true,
      imports: [DiscoveryModule, ...providers.map((provider) => provider.module)],
      providers: [
        {
          provide: LOADED_EMAIL_PROVIDER_CODE,
          useValue: providers.map((provider) => provider.code),
        },
        { provide: EMAIL_ROUTE_DELEGATED, useValue: delegated },
        EmailProviderRegistry,
      ],
      exports: [EmailProviderRegistry],
    };
  }
}
