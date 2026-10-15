import { Module, type DynamicModule } from "@nestjs/common";
import type { AdminAuthenticator } from "./auth/admin-authenticator.js";
import { AuthModule } from "./auth/auth.module.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { CommonModule } from "./common/common.module.js";
import type { LocaleConfig } from "./common/locale.js";
import { DatabaseModule } from "./database/database.module.js";
import type { LoadedFeature } from "./features/feature-loader.js";
import { HealthModule } from "./health/health.module.js";

export interface AppModuleOptions {
  databaseUrl: string;
  features: LoadedFeature[];
  locale: LocaleConfig;
  /** Tests only: replaces the default authenticator, which denies every admin request. */
  adminAuthenticator?: AdminAuthenticator;
}

@Module({})
export class AppModule {
  static register(options: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CommonModule.register(options.locale),
        DatabaseModule.forRoot(options.databaseUrl),
        AuthModule.register(options.adminAuthenticator),
        HealthModule,
        CatalogModule,
        ...options.features.map((feature) => feature.module),
      ],
    };
  }
}
