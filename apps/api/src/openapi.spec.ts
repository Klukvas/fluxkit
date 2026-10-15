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

  it("documents the brands routes with request body schemas and problem responses", async () => {
    const committed = JSON.parse(
      await readFile(new URL("../../../docs/api/openapi.json", import.meta.url), "utf8"),
    ) as {
      paths: Record<string, Record<string, OperationDoc>>;
    };
    expect(Object.keys(committed.paths)).toEqual(
      expect.arrayContaining(["/admin/brands", "/admin/brands/{id}"]),
    );
    const create = committed.paths["/admin/brands"]?.["post"];
    expect(create?.requestBody?.content["application/json"]?.schema).toMatchObject({
      type: "object",
      required: ["name"],
      additionalProperties: false,
    });
    for (const [path, method] of [
      ["/admin/brands", "post"],
      ["/admin/brands", "get"],
      ["/admin/brands/{id}", "get"],
      ["/admin/brands/{id}", "patch"],
      ["/admin/brands/{id}", "delete"],
    ] as const) {
      const operation = committed.paths[path]?.[method];
      expect(
        operation?.responses["401"]?.content?.["application/problem+json"],
        `${method} ${path}`,
      ).toBeDefined();
      expect(
        operation?.responses["500"]?.content?.["application/problem+json"],
        `${method} ${path}`,
      ).toBeDefined();
    }
    const update = committed.paths["/admin/brands/{id}"]?.["patch"];
    expect(update?.requestBody?.content["application/json"]?.schema).toMatchObject({
      additionalProperties: false,
    });
    // The openapi-3.0 target of z.toJSONSchema must not leak a JSON-schema-draft `$schema` member into the document.
    expect(JSON.stringify(committed)).not.toContain('"$schema"');
  });
});

interface OperationDoc {
  requestBody?: { content: Record<string, { schema: unknown }> };
  responses: Record<string, { content?: Record<string, unknown> }>;
}
