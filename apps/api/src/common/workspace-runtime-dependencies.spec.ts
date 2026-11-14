import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * Guard for every workspace package under `packages/`: one whose shipped source imports `@nestjs/common` must list it, with
 * Nest's own peers `reflect-metadata` and `rxjs`, as a runtime `dependency` at the API's exact versions, and never as a peer.
 * The production image installs with `pnpm install --prod`, which links neither the peers nor the devDependencies of a
 * workspace package, so a peer-only Nest made the API fail at start the moment it loaded that package (a provider or a feature
 * switched on). The API's versions make pnpm resolve the very same `@nestjs/common` directory as the API: one copy of Nest,
 * one HttpException class. `scripts/deploy-smoke.sh` checks the same thing inside the built image.
 */

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const PACKAGES_DIR = join(REPO_ROOT, "packages");
const NEST_AND_ITS_PEERS = ["@nestjs/common", "reflect-metadata", "rxjs"] as const;
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".turbo"]);
const NEST_IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)["']@nestjs\/common["']/;

interface Manifest {
  name: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function readManifest(path: string): Manifest {
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

function packageDirectories(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name),
  );
  const own = existsSync(join(directory, "package.json")) ? [directory] : [];
  return [...own, ...entries.flatMap((entry) => packageDirectories(join(directory, entry.name)))];
}

function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return SKIPPED_DIRECTORIES.has(entry.name) ? [] : sourceFiles(path);
    }
    const isSource = /\.tsx?$/.test(entry.name) && !/\.(spec|test)\.tsx?$/.test(entry.name);
    return isSource ? [path] : [];
  });
}

function importsNest(packageDirectory: string): boolean {
  return sourceFiles(join(packageDirectory, "src")).some((file) =>
    NEST_IMPORT.test(readFileSync(file, "utf8")),
  );
}

/** What is wrong with one Nest-importing package's manifest, as readable lines (empty when it is right). */
function manifestProblems(manifest: Manifest, apiVersions: Record<string, string>): string[] {
  const peerProblems = NEST_AND_ITS_PEERS.filter(
    (name) => manifest.peerDependencies?.[name] !== undefined,
  ).map((name) => `${manifest.name}: ${name} must not be a peer dependency`);
  const dependencyProblems = NEST_AND_ITS_PEERS.filter(
    (name) => manifest.dependencies?.[name] !== apiVersions[name],
  ).map(
    (name) =>
      `${manifest.name}: dependencies.${name} is ${manifest.dependencies?.[name] ?? "missing"}, expected ${apiVersions[name]} (the API's)`,
  );
  return [...peerProblems, ...dependencyProblems];
}

describe("runtime dependencies of the workspace packages", () => {
  const api = readManifest(join(REPO_ROOT, "apps", "api", "package.json"));
  const apiVersions = Object.fromEntries(
    NEST_AND_ITS_PEERS.map((name) => [name, api.dependencies?.[name] ?? ""]),
  );
  const nestImporters = packageDirectories(PACKAGES_DIR).filter(importsNest);
  const relativeImporters = nestImporters.map((directory) => relative(REPO_ROOT, directory));

  it("knows the API's versions of Nest and its peers", () => {
    expect(Object.values(apiVersions).every((version) => /^\d+\.\d+\.\d+$/.test(version))).toBe(
      true,
    );
  });

  // Not vacuous: the API kit always imports Nest, and every provider and feature package on disk does too (the CI matrix
  // deletes some of them, so the list is read from disk rather than written out here).
  it("finds the API kit and every provider and feature package among the Nest importers", () => {
    const providersAndFeatures = ["providers", "features"].flatMap((group) =>
      existsSync(join(PACKAGES_DIR, group))
        ? readdirSync(join(PACKAGES_DIR, group), { withFileTypes: true })
            .filter((entry) => existsSync(join(PACKAGES_DIR, group, entry.name, "package.json")))
            .map((entry) => join("packages", group, entry.name))
        : [],
    );
    expect(relativeImporters).toContain(join("packages", "api-kit"));
    expect(relativeImporters).toEqual(expect.arrayContaining(providersAndFeatures));
  });

  it("lists Nest and its peers as runtime dependencies at the API's versions, never as peers", () => {
    const problems = nestImporters.flatMap((directory) =>
      manifestProblems(readManifest(join(directory, "package.json")), apiVersions),
    );
    expect(problems).toEqual([]);
  });
});
