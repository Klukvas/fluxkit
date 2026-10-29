import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument, createApp, OPENAPI_SEARCH_ENV } from "./app.factory.js";

// Fails when docs/api/openapi.json is stale. Regenerate with: pnpm --filter @fluxkit/api build && pnpm --filter @fluxkit/api openapi:export
describe("OpenAPI document", () => {
  it("matches the committed docs/api/openapi.json (core routes only)", async () => {
    const app = await createApp({
      databaseUrl: "postgres://openapi-export:unused@127.0.0.1:1/unused",
      enabledFeatures: [],
      featuresDir: undefined,
      search: OPENAPI_SEARCH_ENV,
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
  describe("the store contract the typed storefront client is generated from", () => {
    const WRITE_METHODS = ["post", "put", "patch", "delete"] as const;

    async function committedDocument(): Promise<StoreDocument> {
      return JSON.parse(
        await readFile(new URL("../../../docs/api/openapi.json", import.meta.url), "utf8"),
      ) as StoreDocument;
    }

    it("documents the 403 problem and the X-Fluxkit-CSRF header on every state-changing store route", async () => {
      const { paths } = await committedDocument();
      const writes = Object.entries(paths).flatMap(([path, methods]) =>
        path.startsWith("/store/")
          ? WRITE_METHODS.flatMap((method) => {
              const operation = methods[method];
              return operation === undefined ? [] : [{ label: `${method} ${path}`, operation }];
            })
          : [],
      );
      // Guards the guard: the cart, checkout, orders and account writes are all there.
      expect(writes.length).toBeGreaterThanOrEqual(14);
      for (const { label, operation } of writes) {
        expect(
          operation.responses["403"]?.content?.["application/problem+json"],
          `${label}: 403`,
        ).toEqual({ schema: { $ref: "#/components/schemas/ProblemDetailsDoc" } });
        expect(operation.responses["403"]?.description, `${label}: 403 text`).toContain(
          "X-Fluxkit-CSRF",
        );
        expect(
          operation.parameters?.filter((parameter) => parameter.name === "X-Fluxkit-CSRF"),
          `${label}: header`,
        ).toEqual([
          expect.objectContaining({
            in: "header",
            required: true,
            schema: { enum: ["1"], type: "string" },
          }),
        ]);
      }
    });

    it("documents no CSRF header or 403 on store reads and on admin routes it does not apply to", async () => {
      const { paths } = await committedDocument();
      for (const [path, methods] of Object.entries(paths)) {
        if (!path.startsWith("/store/")) continue;
        const read = methods["get"];
        if (read === undefined) continue;
        expect(read.responses["403"], `get ${path}`).toBeUndefined();
        expect(
          read.parameters?.some((parameter) => parameter.name === "X-Fluxkit-CSRF") ?? false,
          `get ${path}`,
        ).toBe(false);
      }
    });

    it("types the cart in every cart response and in the cart of a cart_changed problem (requiresShipping, notices union)", async () => {
      const { paths, components } = await committedDocument();
      const cartRoutes: [string, "get" | "post" | "patch" | "delete"][] = [
        ["/store/cart", "get"],
        ["/store/cart/items", "post"],
        ["/store/cart/items/{variantId}", "patch"],
        ["/store/cart/items/{variantId}", "delete"],
        ["/store/cart/acknowledge", "post"],
      ];
      const problemCart = components.schemas["ProblemDetailsDoc"]?.properties?.["cart"];
      for (const cart of [
        ...cartRoutes.map(
          ([path, method]) =>
            paths[path]?.[method]?.responses["200"]?.content?.["application/json"]?.schema,
        ),
        problemCart,
      ]) {
        expect(cart).toMatchObject({
          type: "object",
          required: expect.arrayContaining(["lines", "subtotal", "total", "requiresShipping"]),
          properties: { requiresShipping: { type: "boolean" } },
        });
        const lineNotice = (cart as CartSchema).properties.lines.items.properties.notices.items;
        expect(lineNotice.oneOf ?? lineNotice.anyOf).toHaveLength(4);
      }
      expect(JSON.stringify(problemCart)).not.toContain('additionalProperties":true');
    });
  });
});

interface OperationDoc {
  requestBody?: { content: Record<string, { schema: unknown }> };
  parameters?: { name: string; in: string; required?: boolean; schema?: unknown }[];
  responses: Record<
    string,
    { description?: string; content?: Record<string, { schema?: unknown }> }
  >;
}

interface StoreDocument {
  paths: Record<string, Partial<Record<"get" | "post" | "put" | "patch" | "delete", OperationDoc>>>;
  components: { schemas: Record<string, { properties?: Record<string, unknown> } | undefined> };
}

interface CartSchema {
  properties: {
    lines: {
      items: { properties: { notices: { items: { oneOf?: unknown[]; anyOf?: unknown[] } } } };
    };
  };
}
