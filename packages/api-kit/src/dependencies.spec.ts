import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_JSON = join(SOURCE_DIR, "..", "package.json");
const API_PACKAGE_JSON = join(SOURCE_DIR, "..", "..", "..", "apps", "api", "package.json");

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

  // Runtime dependencies, not peers: the production image installs with `pnpm install --prod`, which links neither a
  // workspace package's peers nor its devDependencies, so a peer-only @nestjs/common was missing at start (deploy-smoke).
  // Nest's own peers (reflect-metadata, rxjs) are listed at the API's versions so pnpm resolves the very same
  // @nestjs/common directory as the API: one copy of Nest, one HttpException class.
  it("declares @fluxkit/core and Nest (with Nest's peers, at the API's versions) at runtime, no peers", () => {
    const manifest = JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const api = JSON.parse(readFileSync(API_PACKAGE_JSON, "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(manifest.dependencies).toEqual({
      "@fluxkit/core": "workspace:*",
      "@nestjs/common": api.dependencies["@nestjs/common"],
      "reflect-metadata": api.dependencies["reflect-metadata"],
      rxjs: api.dependencies.rxjs,
    });
    expect(manifest.dependencies?.["@nestjs/common"]).toBe("12.2.0");
    expect(manifest.peerDependencies).toBeUndefined();
  });
});
