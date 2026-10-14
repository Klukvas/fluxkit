import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument, createApp } from "./app.factory.js";

// Fails when docs/api/openapi.json is stale. Regenerate with: pnpm --filter @fluxkit/api build && pnpm --filter @fluxkit/api openapi:export
describe("OpenAPI document", () => {
  it("matches the committed docs/api/openapi.json (core routes only)", async () => {
    const app = await createApp({
      databaseUrl: "postgres://openapi-export:unused@127.0.0.1:1/unused",
      enabledFeatures: [],
      featuresDir: undefined,
    });
    await app.init();
    try {
      const generated = JSON.parse(JSON.stringify(buildOpenApiDocument(app))) as unknown;
      const committed = JSON.parse(
        await readFile(new URL("../../../docs/api/openapi.json", import.meta.url), "utf8"),
      ) as unknown;
      expect(generated).toEqual(committed);
    } finally {
      await app.close();
    }
  });
});
