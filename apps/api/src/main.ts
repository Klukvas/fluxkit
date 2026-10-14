import { loadEnv } from "@fluxkit/config";
import { SwaggerModule } from "@nestjs/swagger";
import { buildOpenApiDocument, createApp } from "./app.factory.js";

async function bootstrap(): Promise<void> {
  const env = loadEnv(process.env);
  const app = await createApp(env);
  SwaggerModule.setup("docs", app, buildOpenApiDocument(app));
  await app.listen(env.port);
}

bootstrap().catch((error: unknown) => {
  console.error("Failed to start the API", error);
  process.exit(1);
});
