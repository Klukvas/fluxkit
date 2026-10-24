import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Type } from "@nestjs/common";
import { SHIPPING_PROVIDER_CODE_PATTERN, SHIPPING_PROVIDER_PACKAGE_KIND } from "@fluxkit/core";

export interface LoadedShippingProvider {
  code: string;
  module: Type<unknown>;
}

interface ProviderManifest {
  dir: string;
  code: string;
  main: string;
}

/** Default location of provider packages: <repo>/packages/providers (also works from dist/). */
export const DEFAULT_SHIPPING_PROVIDERS_DIR = fileURLToPath(
  new URL("../../../../../packages/providers", import.meta.url),
);

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

async function readManifests(providersDir: string): Promise<ProviderManifest[]> {
  let entries: string[];
  try {
    entries = await readdir(providersDir);
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }
    throw error;
  }
  const manifests: ProviderManifest[] = [];
  for (const entry of entries) {
    const dir = join(providersDir, entry);
    const manifestPath = join(dir, "package.json");
    let raw: string;
    try {
      raw = await readFile(manifestPath, "utf8");
    } catch (error) {
      if (isMissing(error)) {
        continue;
      }
      throw error;
    }
    let pkg: { main?: string; fluxkit?: { provider?: unknown; kind?: unknown } };
    try {
      pkg = JSON.parse(raw) as typeof pkg;
    } catch (error) {
      throw new Error(`Cannot parse ${manifestPath}: ${(error as Error).message}`, {
        cause: error,
      });
    }
    const code = pkg.fluxkit?.provider;
    if (code === undefined) {
      continue;
    }
    // Other kinds of provider (payment, later) live in the same folder and are none of this loader's business.
    if (pkg.fluxkit?.kind !== undefined && pkg.fluxkit.kind !== SHIPPING_PROVIDER_PACKAGE_KIND) {
      continue;
    }
    if (pkg.fluxkit?.kind === undefined) {
      throw new Error(
        `${manifestPath} declares "fluxkit.provider" without "fluxkit.kind" (expected "${SHIPPING_PROVIDER_PACKAGE_KIND}").`,
      );
    }
    if (typeof code !== "string" || !SHIPPING_PROVIDER_CODE_PATTERN.test(code)) {
      throw new Error(
        `Invalid shipping provider code ${JSON.stringify(code)} in ${manifestPath}. Use lowercase letters, digits and underscores, starting with a letter.`,
      );
    }
    const duplicate = manifests.find((existing) => existing.code === code);
    if (duplicate !== undefined) {
      throw new Error(
        `Shipping provider "${code}" is declared twice: ${duplicate.dir} and ${dir}.`,
      );
    }
    manifests.push({ dir, code, main: pkg.main ?? "dist/index.js" });
  }
  return manifests;
}

/**
 * Loads exactly the enabled shipping providers (ADR 0029 decision 8), the way `loadFeatures` loads features: providers are
 * discovered on disk by their manifest and imported dynamically, so neither core nor this app has a static reference to
 * any of them and deleting a provider folder never breaks the build. With nothing enabled the folder is not even read.
 * An enabled provider that is missing, whose entry point is broken or that does not export `providerModule` fails loudly
 * at startup; a disabled or deleted one has no effect.
 */
export async function loadShippingProviders(options: {
  enabled: readonly string[];
  providersDir: string;
}): Promise<LoadedShippingProvider[]> {
  if (options.enabled.length === 0) {
    return [];
  }
  const manifests = await readManifests(options.providersDir);
  const loaded: LoadedShippingProvider[] = [];
  for (const code of new Set(options.enabled)) {
    const manifest = manifests.find((candidate) => candidate.code === code);
    if (manifest === undefined) {
      throw new Error(
        `Shipping provider "${code}" is enabled in SHIPPING_PROVIDERS_ENABLED but no package with "fluxkit": {"provider": "${code}", "kind": "${SHIPPING_PROVIDER_PACKAGE_KIND}"} was found in ${options.providersDir}.`,
      );
    }
    const entryPath = resolve(manifest.dir, manifest.main);
    const relativeEntry = relative(manifest.dir, entryPath);
    if (
      relativeEntry.startsWith(`..${sep}`) ||
      relativeEntry === ".." ||
      resolve(relativeEntry) === relativeEntry
    ) {
      throw new Error(
        `Shipping provider "${code}": "main" (${manifest.main}) must stay inside ${manifest.dir}.`,
      );
    }
    let imported: { providerModule?: Type<unknown> };
    try {
      imported = (await import(pathToFileURL(entryPath).href)) as typeof imported;
    } catch (error) {
      throw new Error(
        `Shipping provider "${code}" could not be loaded from ${manifest.main}: ${(error as Error).message}`,
        { cause: error },
      );
    }
    if (typeof imported.providerModule !== "function") {
      throw new Error(
        `Shipping provider "${code}" must export "providerModule" (a Nest module class) from ${manifest.main}.`,
      );
    }
    loaded.push({ code, module: imported.providerModule });
  }
  return loaded;
}
