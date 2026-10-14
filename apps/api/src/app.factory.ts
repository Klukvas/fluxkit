import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from "@nestjs/swagger";
import type { AppEnv } from "@fluxkit/config";
import { AppModule } from "./app.module.js";
import { DEFAULT_FEATURES_DIR, loadFeatures } from "./features/feature-loader.js";

export async function createApp(
  env: Pick<AppEnv, "databaseUrl" | "enabledFeatures" | "featuresDir">,
): Promise<NestExpressApplication> {
  const features = await loadFeatures({
    enabled: env.enabledFeatures,
    featuresDir: env.featuresDir ?? DEFAULT_FEATURES_DIR,
  });
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register({ databaseUrl: env.databaseUrl, features }),
    { logger: ["error", "warn", "log"] },
  );
  app.enableShutdownHooks();
  return app;
}

export function buildOpenApiDocument(app: NestExpressApplication): OpenAPIObject {
  const config = new DocumentBuilder().setTitle("Fluxkit API").setVersion("0.0.0").build();
  return SwaggerModule.createDocument(app, config);
}
