import { Logger } from "@nestjs/common";
import { loadEnv } from "@fluxkit/config";
import { SwaggerModule } from "@nestjs/swagger";
import { buildOpenApiDocument, createApp } from "./app.factory.js";
import { emailProviderStartupWarning, storefrontUrlStartupWarning } from "./email/auth/index.js";
import { prepareDefaultMediaDirectory } from "./media/media-directory.js";
import { retentionStartupWarning } from "./privacy/privacy-config.js";

async function bootstrap(): Promise<void> {
  const env = loadEnv(process.env);
  if (env.orderTokenSecret === undefined) {
    // loadEnv only demands it in production; the server needs it everywhere, or a guest could not be given a token.
    throw new Error(
      "ORDER_TOKEN_SECRET is required to start the API (at least 32 characters; see .env.example).",
    );
  }
  await prepareDefaultMediaDirectory(env, process.env);
  const app = await createApp(env);
  const emailWarnings = [
    emailProviderStartupWarning(env.emailProvider, process.env["NODE_ENV"]),
    storefrontUrlStartupWarning(
      env.emailProvider,
      process.env["STOREFRONT_PUBLIC_URL"],
      process.env["NODE_ENV"],
    ),
  ];
  for (const warning of emailWarnings) {
    if (warning !== undefined) {
      new Logger("EmailDelivery").warn(warning);
    }
  }
  const retentionWarning = retentionStartupWarning(
    env.orderContactRetentionDays,
    process.env["NODE_ENV"],
  );
  if (retentionWarning !== undefined) {
    new Logger("Privacy").warn(retentionWarning);
  }
  SwaggerModule.setup("docs", app, buildOpenApiDocument(app));
  await app.listen(env.port);
}

bootstrap().catch((error: unknown) => {
  console.error("Failed to start the API", error);
  process.exit(1);
});
