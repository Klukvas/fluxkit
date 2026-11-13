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

/*
 * The API kit's `./internal` entry is for apps/api only (ADR 0049). dependency-cruiser cannot see it (the entry resolves
 * into the kit's `dist/`, which it does not cruise), so the import is refused here by its text: in every feature package,
 * provider package and core fixture feature.
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

  it("never imports @fluxkit/api-kit/internal", () => {
    const offenders = files
      .filter((file) => /["']@fluxkit\/api-kit\/internal["']/.test(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });
});
