import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface Operation {
  parameters?: { name: string; in: string; required?: boolean; description?: string }[];
  requestBody?: { required?: boolean; content: Record<string, { schema?: unknown }> };
  responses: Record<string, { description?: string; content?: Record<string, unknown> }>;
  "x-fluxkit-permission"?: unknown;
}

async function committedPaths(): Promise<Record<string, Record<string, Operation>>> {
  const document = JSON.parse(
    await readFile(new URL("../../../../docs/api/openapi.json", import.meta.url), "utf8"),
  ) as { paths: Record<string, Record<string, Operation>> };
  return document.paths;
}

describe("the media routes in docs/api/openapi.json (ADR 0028)", () => {
  it("documents the upload: binary octet-stream body, catalog.write, the CSRF header and every problem status", async () => {
    const operation = (await committedPaths())["/admin/media/uploads"]?.["post"];
    expect(operation).toBeDefined();
    expect(operation?.requestBody).toMatchObject({
      required: true,
      content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
    });
    expect(operation?.["x-fluxkit-permission"]).toBe("catalog.write");
    const csrf = operation?.parameters?.filter((parameter) => parameter.name === "X-Fluxkit-CSRF");
    expect(csrf).toHaveLength(1);
    expect(csrf?.[0]?.description).toContain("application/octet-stream");
    for (const status of ["400", "401", "403", "411", "413", "429", "500", "503"]) {
      expect(
        operation?.responses[status]?.content?.["application/problem+json"],
        status,
      ).toBeDefined();
    }
    expect(operation?.responses["403"]?.description).toContain("application/octet-stream");
    // Every reason of the upload's own 400 answers is named (output_too_large: step 9 review M-1).
    for (const reason of [
      "empty_file",
      "unsupported_type",
      "corrupt_image",
      "animated_not_supported",
      "dimensions_too_large",
      "too_many_pixels",
      "processing_timeout",
      "output_too_large",
    ]) {
      expect(operation?.responses["400"]?.description, reason).toContain(reason);
    }
    expect(operation?.responses["201"]?.content?.["application/json"]).toBeDefined();
  });

  it("documents the public read route outside /admin, without a permission or CSRF header", async () => {
    const paths = await committedPaths();
    const read = paths["/media/{key}"];
    expect(Object.keys(read ?? {}).sort()).toEqual(["get", "head"]);
    for (const operation of Object.values(read ?? {})) {
      expect(operation["x-fluxkit-permission"]).toBeUndefined();
      expect(operation.parameters?.some((parameter) => parameter.name === "X-Fluxkit-CSRF")).toBe(
        false,
      );
      expect(operation.responses["404"]).toBeDefined();
    }
    expect(Object.keys(paths).filter((path) => path.startsWith("/media"))).toEqual([
      "/media/{key}",
    ]);
  });

  it("documents the media block of GET /admin/config", async () => {
    const operation = (await committedPaths())["/admin/config"]?.["get"];
    const schema = operation?.responses["200"]?.content?.["application/json"] as {
      schema: { required: string[]; properties: Record<string, { required?: string[] }> };
    };
    expect(schema.schema.required).toContain("media");
    expect(schema.schema.properties["media"]?.required?.sort()).toEqual(
      ["contentTypes", "maxBytes", "uploadsEnabled"].sort(),
    );
  });
});
