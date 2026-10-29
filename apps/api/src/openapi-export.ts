import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildOpenApiDocument, createApp, OPENAPI_SEARCH_ENV } from "./app.factory.js";

// Writes docs/api/openapi.json. The database is never contacted: the pool connects lazily and nothing queries it.
const outputPath = fileURLToPath(new URL("../../../docs/api/openapi.json", import.meta.url));

const app = await createApp({
  databaseUrl: "postgres://openapi-export:unused@127.0.0.1:1/unused",
  enabledFeatures: process.env["OPENAPI_FEATURES"]?.split(",").filter(Boolean) ?? [],
  featuresDir: undefined,
  search: OPENAPI_SEARCH_ENV,
});
await app.init();
await writeFile(outputPath, `${JSON.stringify(buildOpenApiDocument(app), null, 2)}\n`);
await app.close();
console.log(`OpenAPI written to ${outputPath}`);
