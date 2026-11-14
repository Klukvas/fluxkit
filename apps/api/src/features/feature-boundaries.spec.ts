import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const SKIPPED = new Set(["node_modules", "dist", "coverage"]);

function sourceFiles(directory: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((name) => !SKIPPED.has(name))
    .flatMap((name) => {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.tsx?$/.test(name) ? [path] : [];
    });
}

/** Any module specifier (any quote, template literals included) past the kit's public entry: `/internal` or a file inside it. */
function reachesKitInternals(source: string): boolean {
  return /["'`](?:@fluxkit\/api-kit\/[^"'`]+|[^"'`]*\bapi-kit\/(?:src|dist)\/[^"'`]*)["'`]/.test(
    source,
  );
}

/*
 * The API kit's `./internal` entry is for apps/api only (ADR 0049). dependency-cruiser cannot see it (the entry resolves
 * into the kit's `dist/`, which it does not cruise), so the import is refused here by its text: in every feature package,
 * provider package and core fixture feature. Any subpath of `@fluxkit/api-kit` and any relative path into the kit's `src/`
 * or `dist/` counts, whatever the quotes.
 */
describe("feature and provider packages use the API kit's public entry only (ADR 0049)", () => {
  const files = [
    ...sourceFiles(join(ROOT, "packages/features")),
    ...sourceFiles(join(ROOT, "packages/providers")),
    ...sourceFiles(join(ROOT, "apps/api/src/test/fixtures/features")),
  ];

  it("finds the sources (the check below is not vacuous: the core fixtures always exist)", () => {
    expect(files.some((file) => file.includes("fixtures/features/notebook/"))).toBe(true);
  });

  it("never imports @fluxkit/api-kit/internal or a file inside the kit", () => {
    const offenders = files
      .filter((file) => reachesKitInternals(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it("recognises every way of reaching past the public entry (mutation cases)", () => {
    const refused = [
      'import { PERMISSION_KEY } from "@fluxkit/api-kit/internal";',
      "import { PERMISSION_KEY } from '@fluxkit/api-kit/internal';",
      "const kit = await import(`@fluxkit/api-kit/internal`);",
      'export * from "@fluxkit/api-kit/internal.js";',
      'import { x } from "../../../../packages/api-kit/dist/internal.js";',
      'import { x } from "../../api-kit/src/route-access.js";',
      'import { x } from "@fluxkit/api-kit/dist/index.js";',
      'const m = require("@fluxkit/api-kit/src/internal");',
    ];
    const allowed = [
      'import { AdminController, ProblemException } from "@fluxkit/api-kit";',
      "import { MEDIA_PORT } from '@fluxkit/api-kit';",
    ];
    expect(refused.filter((source) => !reachesKitInternals(source))).toEqual([]);
    expect(allowed.filter(reachesKitInternals)).toEqual([]);
  });
});
