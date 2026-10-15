import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from "@nestjs/swagger";
import { DEFAULT_LOCALE, DEFAULT_LOCALES, type AppEnv } from "@fluxkit/config";
import { AppModule } from "./app.module.js";
import type { AdminAuthenticator } from "./auth/admin-authenticator.js";
import { DEFAULT_FEATURES_DIR, loadFeatures } from "./features/feature-loader.js";

export type CreateAppEnv = Pick<AppEnv, "databaseUrl" | "enabledFeatures" | "featuresDir"> &
  Partial<Pick<AppEnv, "defaultLocale" | "locales">>;

export interface CreateAppOptions {
  /** Tests only. Without it the default authenticator denies every admin request (no auth plan yet). */
  adminAuthenticator?: AdminAuthenticator;
}

export async function createApp(
  env: CreateAppEnv,
  options: CreateAppOptions = {},
): Promise<NestExpressApplication> {
  const features = await loadFeatures({
    enabled: env.enabledFeatures,
    featuresDir: env.featuresDir ?? DEFAULT_FEATURES_DIR,
  });
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register({
      databaseUrl: env.databaseUrl,
      features,
      locale: {
        defaultLocale: env.defaultLocale ?? DEFAULT_LOCALE,
        locales: env.locales ?? DEFAULT_LOCALES,
      },
      adminAuthenticator: options.adminAuthenticator,
    }),
    { logger: ["error", "warn", "log"] },
  );
  app.enableShutdownHooks();
  return app;
}

export function buildOpenApiDocument(app: NestExpressApplication): OpenAPIObject {
  const config = new DocumentBuilder().setTitle("Fluxkit API").setVersion("0.0.0").build();
  return SwaggerModule.createDocument(app, config);
}
