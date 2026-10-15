import type { NestExpressApplication } from "@nestjs/platform-express";
import { createApp } from "../app.factory.js";
import type { AdminAuthenticator } from "../auth/admin-authenticator.js";
import { AllowAllAdminAuthenticator } from "./allow-all-admin-authenticator.js";
import { requireEnv } from "./env.js";

export interface RunningApp {
  app: NestExpressApplication;
  baseUrl: string;
}

export interface StartAppOptions {
  enabledFeatures?: string[];
  featuresDir?: string;
  /**
   * Test authenticator for `/admin`. Defaults to allow-all. Pass `"production-default"` to run with the real
   * default (deny everything), as the guard specs do.
   */
  adminAuthenticator?: AdminAuthenticator | "production-default";
}

export async function startApp(options: StartAppOptions = {}): Promise<RunningApp> {
  const authenticator = options.adminAuthenticator ?? new AllowAllAdminAuthenticator();
  const app = await createApp(
    {
      databaseUrl: requireEnv("DATABASE_URL"),
      enabledFeatures: options.enabledFeatures ?? [],
      featuresDir: options.featuresDir,
    },
    { adminAuthenticator: authenticator === "production-default" ? undefined : authenticator },
  );
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as { port: number };
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}
