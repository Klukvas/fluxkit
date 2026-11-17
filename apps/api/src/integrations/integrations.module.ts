import { Module, type DynamicModule } from "@nestjs/common";
import { InstalledIntegrations } from "./installed-integrations.js";
import { INTEGRATIONS_CONFIG, type IntegrationsConfig } from "./integrations.config.js";
import { IntegrationsController } from "./integrations.controller.js";
import { IntegrationsRepository } from "./integrations.repository.js";
import { IntegrationsService } from "./integrations.service.js";
import { SecretCipher } from "./secret-cipher.js";

/**
 * Managed integration credentials (ADR 0058): the encrypted store and its owner-only admin API. Core, no feature flag:
 * without `SECRETS_ENCRYPTION_KEY` the routes answer and report `storage: "disabled"`, and nothing can be saved. Uses
 * the global auth, audit and rate-limit modules; imports no provider package statically.
 */
@Module({})
export class IntegrationsModule {
  static register(config: IntegrationsConfig): DynamicModule {
    return {
      module: IntegrationsModule,
      controllers: [IntegrationsController],
      providers: [
        { provide: INTEGRATIONS_CONFIG, useValue: config },
        { provide: SecretCipher, useFactory: () => new SecretCipher(config.keyRing) },
        InstalledIntegrations,
        IntegrationsRepository,
        IntegrationsService,
      ],
    };
  }
}
