import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Type } from "@nestjs/common";

export interface LoadedFeature {
  name: string;
  module: Type<unknown>;
}

interface FeatureManifest {
  dir: string;
  name: string;
  main: string;
}

/** Default location of feature packages: <repo>/packages/features (also works from dist/). */
export const DEFAULT_FEATURES_DIR = new URL("../../../../packages/features", import.meta.url)
  .pathname;

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
    const pkg = JSON.parse(raw) as { main?: string; fluxkit?: { feature?: string } };
    const name = pkg.fluxkit?.feature;
    if (name !== undefined) {
      manifests.push({ dir, name, main: pkg.main ?? "dist/index.js" });
    }
  }
  return manifests;
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
  if (options.enabled.length === 0) {
    return [];
  }
  const manifests = await readManifests(options.featuresDir);
  const loaded: LoadedFeature[] = [];
  for (const name of options.enabled) {
    const manifest = manifests.find((candidate) => candidate.name === name);
    if (manifest === undefined) {
      throw new Error(
        `Feature "${name}" is enabled in FEATURES_ENABLED but no package with "fluxkit.feature": "${name}" was found in ${options.featuresDir}.`,
      );
    }
    const entry = pathToFileURL(join(manifest.dir, manifest.main)).href;
    const imported = (await import(entry)) as { featureModule?: Type<unknown> };
    if (imported.featureModule === undefined) {
      throw new Error(`Feature "${name}" must export "featureModule" from ${manifest.main}.`);
    }
    loaded.push({ name, module: imported.featureModule });
  }
  return loaded;
}
