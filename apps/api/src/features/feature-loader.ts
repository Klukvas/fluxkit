import { access, readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Type } from "@nestjs/common";

export interface LoadedFeature {
  name: string;
  module: Type<unknown>;
  /** The feature's `drizzle/` folder when it ships migrations (`drizzle/meta/_journal.json`, ADR 0049); else absent. */
  migrationsFolder?: string;
  /** The feature's `personalDataInventory` export as found, unchecked (ADR 0049, E3); absent when it exports none. */
  personalDataInventory?: unknown;
}

/** A feature package found on disk: its folder, its manifest name and its entry file. */
export interface FeatureManifest {
  dir: string;
  name: string;
  main: string;
}

/** Default location of feature packages: <repo>/packages/features (also works from dist/). */
export const DEFAULT_FEATURES_DIR = fileURLToPath(
  new URL("../../../../packages/features", import.meta.url),
);

const FEATURE_NAME = /^[a-z][a-z0-9-]*$/;

async function readManifests(featuresDir: string): Promise<FeatureManifest[]> {
  let entries: string[];
  try {
    entries = await readdir(featuresDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const manifests: FeatureManifest[] = [];
  for (const entry of entries) {
    const dir = join(featuresDir, entry);
    let raw: string;
    try {
      raw = await readFile(join(dir, "package.json"), "utf8");
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === "ENOENT" ||
        (error as NodeJS.ErrnoException).code === "ENOTDIR"
      ) {
        continue;
      }
      throw error;
    }
    const manifestPath = join(dir, "package.json");
    let pkg: { main?: string; fluxkit?: { feature?: string } };
    try {
      pkg = JSON.parse(raw) as typeof pkg;
    } catch (error) {
      throw new Error(`Cannot parse ${manifestPath}: ${(error as Error).message}`, {
        cause: error,
      });
    }
    const name = pkg.fluxkit?.feature;
    if (name === undefined) {
      continue;
    }
    if (!FEATURE_NAME.test(name)) {
      throw new Error(
        `Invalid feature name "${name}" in ${manifestPath}. Use lowercase letters, digits and dashes.`,
      );
    }
    const duplicate = manifests.find((existing) => existing.name === name);
    if (duplicate !== undefined) {
      throw new Error(`Feature "${name}" is declared twice: ${duplicate.dir} and ${dir}.`);
    }
    manifests.push({ dir, name, main: pkg.main ?? "dist/index.js" });
  }
  return manifests;
}

/**
 * The packages of the enabled features, in the order of `enabled`. Reads manifests only, never imports a feature. An
 * enabled feature without a package fails loudly (a deleted folder with the flag still on).
 */
export async function findEnabledFeatures(options: {
  enabled: readonly string[];
  featuresDir: string;
}): Promise<FeatureManifest[]> {
  if (options.enabled.length === 0) {
    return [];
  }
  const manifests = await readManifests(options.featuresDir);
  return options.enabled.map((name) => {
    const manifest = manifests.find((candidate) => candidate.name === name);
    if (manifest === undefined) {
      throw new Error(
        `Feature "${name}" is enabled in FEATURES_ENABLED but no package with "fluxkit.feature": "${name}" was found in ${options.featuresDir}.`,
      );
    }
    return manifest;
  });
}

/** `<dir>/drizzle` when the feature ships migrations (a `drizzle/meta/_journal.json`), else `undefined`. */
export async function featureMigrationsFolder(dir: string): Promise<string | undefined> {
  const folder = join(dir, "drizzle");
  try {
    await access(join(folder, "meta", "_journal.json"));
    return folder;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

/**
 * Loads exactly the enabled features. Features are discovered on disk and imported dynamically, so core has no static
 * reference to any of them: deleting a feature folder never breaks the build. A feature that is enabled but missing
 * or broken fails loudly at startup.
 */
export async function loadFeatures(options: {
  enabled: string[];
  featuresDir: string;
}): Promise<LoadedFeature[]> {
  const loaded: LoadedFeature[] = [];
  for (const manifest of await findEnabledFeatures(options)) {
    const { name } = manifest;
    const entryPath = resolve(manifest.dir, manifest.main);
    const relativeEntry = relative(manifest.dir, entryPath);
    if (
      relativeEntry.startsWith(`..${sep}`) ||
      relativeEntry === ".." ||
      resolve(relativeEntry) === relativeEntry
    ) {
      throw new Error(
        `Feature "${name}": "main" (${manifest.main}) must stay inside ${manifest.dir}.`,
      );
    }
    const entry = pathToFileURL(entryPath).href;
    const imported = (await import(entry)) as {
      featureModule?: Type<unknown>;
      personalDataInventory?: unknown;
    };
    if (imported.featureModule === undefined) {
      throw new Error(`Feature "${name}" must export "featureModule" from ${manifest.main}.`);
    }
    const migrationsFolder = await featureMigrationsFolder(manifest.dir);
    loaded.push({
      name,
      module: imported.featureModule,
      ...(migrationsFolder === undefined ? {} : { migrationsFolder }),
      ...("personalDataInventory" in imported
        ? { personalDataInventory: imported.personalDataInventory }
        : {}),
    });
  }
  return loaded;
}
