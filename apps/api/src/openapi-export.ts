import { writeFile } from "node:fs/promises";
import { buildOpenApiDocument, createApp } from "./app.factory.js";

// Writes docs/api/openapi.json. The database is never contacted: the pool connects lazily and nothing queries it.
const outputPath = new URL("../../../docs/api/openapi.json", import.meta.url).pathname;

const app = await createApp({
  databaseUrl: "postgres://openapi-export:unused@127.0.0.1:1/unused",
  enabledFeatures: process.env["OPENAPI_FEATURES"]?.split(",").filter(Boolean) ?? [],
  featuresDir: undefined,
});
await app.init();
await writeFile(outputPath, `${JSON.stringify(buildOpenApiDocument(app), null, 2)}\n`);
await app.close();
console.log(`OpenAPI written to ${outputPath}`);
