import { Module, type DynamicModule } from "@nestjs/common";
import { DatabaseModule } from "./database/database.module.js";
import type { LoadedFeature } from "./features/feature-loader.js";
import { HealthModule } from "./health/health.module.js";

@Module({})
export class AppModule {
  static register(options: { databaseUrl: string; features: LoadedFeature[] }): DynamicModule {
    return {
      module: AppModule,
      imports: [
        DatabaseModule.forRoot(options.databaseUrl),
        HealthModule,
        ...options.features.map((feature) => feature.module),
      ],
    };
  }
}
