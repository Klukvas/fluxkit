import { Module, type DynamicModule } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import type { LoadedEmailProvider } from "./email-provider-loader.js";
import { EmailProviderRegistry, LOADED_EMAIL_PROVIDER_CODE } from "./email-provider-registry.js";

/**
 * Mounts the one loaded provider module and the registry that finds its provider. With no provider loaded it imports
 * nothing but discovery and the registry reports `none`: no routes, no tables, no outbound calls. Exactly one provider is
 * active, so a second one (for example `EMAIL_PROVIDER=fake` plus a test provider) stops the startup.
 */
@Module({})
export class EmailRegistryModule {
  static register(providers: readonly LoadedEmailProvider[]): DynamicModule {
    if (providers.length > 1) {
      throw new Error(
        `Only one email provider can be active, but ${providers.length} were loaded (${providers.map((provider) => provider.code).join(", ")}).`,
      );
    }
    return {
      module: EmailRegistryModule,
      // Global: the config routes and, later, the sender and the auth flows read the registry without importing it.
      global: true,
      imports: [DiscoveryModule, ...providers.map((provider) => provider.module)],
      providers: [
        { provide: LOADED_EMAIL_PROVIDER_CODE, useValue: providers[0]?.code ?? null },
        EmailProviderRegistry,
      ],
      exports: [EmailProviderRegistry],
    };
  }
}
