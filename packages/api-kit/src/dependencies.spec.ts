import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_JSON = join(SOURCE_DIR, "..", "package.json");

const ALLOWED = new Set(["@nestjs/common", "@fluxkit/core"]);

function importedModules(source: string): string[] {
  return [
    ...source.matchAll(
      /(?:import|export)\s[^"']*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g,
    ),
  ].map((match) => match[1] ?? match[2] ?? "");
}

// ADR 0049: the kit depends on @nestjs/common and @fluxkit/core only. dependency-cruiser cannot see packages that resolve
// into a `dist/` folder (it excludes them), so the import list of the shipped sources is checked here as well.
describe("the API kit's dependencies", () => {
  const sources = readdirSync(SOURCE_DIR).filter(
    (name) => name.endsWith(".ts") && !name.endsWith(".spec.ts"),
  );

  it("finds the sources (the check below is not vacuous)", () => {
    expect(sources.length).toBeGreaterThan(3);
  });

  it("imports nothing but @nestjs/common, @fluxkit/core and its own files", () => {
    const offenders = sources.flatMap((name) =>
      importedModules(readFileSync(join(SOURCE_DIR, name), "utf8"))
        .filter((module) => !module.startsWith("./") && !ALLOWED.has(module))
        .map((module) => `${name}: ${module}`),
    );
    expect(offenders).toEqual([]);
  });

  it("declares exactly those two at runtime", () => {
    const manifest = JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    expect(manifest.dependencies).toEqual({ "@fluxkit/core": "workspace:*" });
    expect(manifest.peerDependencies).toEqual({ "@nestjs/common": "12.2.0" });
  });
});
