import { Global, Module, type DynamicModule } from "@nestjs/common";
import { coreInventory, mergeFeatureInventories } from "../privacy/inventory/index.js";
import type { LoadedFeature } from "./feature-loader.js";

/** The names of the features loaded from `FEATURES_ENABLED`, sorted (`readonly string[]`); `features` of the config routes. */
export const ENABLED_FEATURES = Symbol("ENABLED_FEATURES");

/**
 * What core reads about the enabled features (ADR 0049): their names, and their personal-data inventories, checked and
 * merged with the core one when the module is registered (before Nest builds anything). Global so the config routes read
 * the names without importing this module. Never mounts a feature itself (`AppModule` does); the startup refusal for
 * unapplied feature migrations runs in `createApp` (`assertFeatureMigrationsAppliedTo`).
 */
@Global()
@Module({})
export class FeaturesModule {
  static register(features: readonly LoadedFeature[]): DynamicModule {
    // Fails the start on a malformed or clashing feature inventory, or a feature with tables and none (ADR 0049, E3).
    mergeFeatureInventories(coreInventory, features);
    const names = Object.freeze(features.map((feature) => feature.name).sort());
    return {
      module: FeaturesModule,
      providers: [{ provide: ENABLED_FEATURES, useValue: names }],
      exports: [ENABLED_FEATURES],
    };
  }
}
