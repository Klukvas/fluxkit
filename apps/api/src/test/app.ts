import type { NestExpressApplication } from "@nestjs/platform-express";
import { createApp } from "../app.factory.js";
import { requireEnv } from "./env.js";

export interface RunningApp {
  app: NestExpressApplication;
  baseUrl: string;
}

export async function startApp(
  options: { enabledFeatures?: string[]; featuresDir?: string } = {},
): Promise<RunningApp> {
  const app = await createApp({
    databaseUrl: requireEnv("DATABASE_URL"),
    enabledFeatures: options.enabledFeatures ?? [],
    featuresDir: options.featuresDir,
  });
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as { port: number };
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}
