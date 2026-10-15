import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from "@nestjs/swagger";
import { DEFAULT_LOCALE, DEFAULT_LOCALES, type AppEnv } from "@fluxkit/config";
import { AppModule } from "./app.module.js";
import type { AdminAuthenticator } from "./auth/admin-authenticator.js";
import { DEFAULT_ADMIN_AUTH_CONFIG } from "./auth/auth-config.js";
import type { Clock } from "./auth/clock.js";
import type { ScryptParams } from "./auth/password-hasher.js";
import {
  DEFAULT_FEATURES_DIR,
  loadFeatures,
  type LoadedFeature,
} from "./features/feature-loader.js";

export type CreateAppEnv = Pick<AppEnv, "databaseUrl" | "enabledFeatures" | "featuresDir"> &
  Partial<
    Pick<
      AppEnv,
      | "defaultLocale"
      | "locales"
      | "adminCookieSecure"
      | "adminSessionIdleMinutes"
      | "adminSessionMaxHours"
    >
  >;

export interface CreateAppOptions {
  /** Tests only. Without it admin requests are authenticated by the session cookie (`SessionAdminAuthenticator`). */
  adminAuthenticator?: AdminAuthenticator;
  /** Tests only: a controlled clock for session expiry. */
  clock?: Clock;
  /** Tests only: cheap scrypt parameters. */
  scrypt?: ScryptParams;
  /** Tests only: extra modules loaded as if they were enabled features (for example a probe controller). */
  extraFeatures?: LoadedFeature[];
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
      features: [...features, ...(options.extraFeatures ?? [])],
      locale: {
        defaultLocale: env.defaultLocale ?? DEFAULT_LOCALE,
        locales: env.locales ?? DEFAULT_LOCALES,
      },
      adminAuth: {
        cookieSecure: env.adminCookieSecure ?? DEFAULT_ADMIN_AUTH_CONFIG.cookieSecure,
        idleMinutes: env.adminSessionIdleMinutes ?? DEFAULT_ADMIN_AUTH_CONFIG.idleMinutes,
        maxHours: env.adminSessionMaxHours ?? DEFAULT_ADMIN_AUTH_CONFIG.maxHours,
      },
      adminAuthenticator: options.adminAuthenticator,
      clock: options.clock,
      scrypt: options.scrypt,
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
