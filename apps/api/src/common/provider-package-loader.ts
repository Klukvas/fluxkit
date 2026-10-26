import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { Type } from "@nestjs/common";

/** A provider package that was found, imported and exports a Nest module (`providerModule`). */
export interface LoadedProviderPackage {
  code: string;
  module: Type<unknown>;
}

interface ProviderManifest {
  dir: string;
  code: string;
  main: string;
}

export interface LoadProviderPackagesOptions {
  /** The `fluxkit.kind` of the packages this call loads (`"shipping"`, `"email"`); packages of another kind are skipped. */
  kind: string;
  /** The enabled codes. With none the folder is not even read. */
  enabled: readonly string[];
  providersDir: string;
  /** The shape of a provider code of this kind (core `SHIPPING_PROVIDER_CODE_PATTERN`, `EMAIL_PROVIDER_CODE_PATTERN`). */
  codePattern: RegExp;
  /** The variable that enables the codes, named in the error of a missing package (`SHIPPING_PROVIDERS_ENABLED`). */
  variable: string;
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** "shipping" -> "Shipping provider": the subject of every message, so the two loaders read alike. */
function subjectOf(kind: string): { capitalized: string; lower: string } {
  const lower = `${kind} provider`;
  return { capitalized: `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`, lower };
}

async function readManifests(
  options: LoadProviderPackagesOptions,
  subject: { capitalized: string; lower: string },
): Promise<ProviderManifest[]> {
  let entries: string[];
  try {
    entries = await readdir(options.providersDir);
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }
    throw error;
  }
  const manifests: ProviderManifest[] = [];
  for (const entry of entries) {
    const dir = join(options.providersDir, entry);
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
    // Other kinds of provider live in the same folder and are none of this loader's business.
    if (pkg.fluxkit?.kind !== undefined && pkg.fluxkit.kind !== options.kind) {
      continue;
    }
    if (pkg.fluxkit?.kind === undefined) {
      throw new Error(
        `${manifestPath} declares "fluxkit.provider" without "fluxkit.kind" (expected "${options.kind}").`,
      );
    }
    if (typeof code !== "string" || !options.codePattern.test(code)) {
      throw new Error(
        `Invalid ${subject.lower} code ${JSON.stringify(code)} in ${manifestPath}. Use lowercase letters, digits and underscores, starting with a letter.`,
      );
    }
    // Codes are unique per kind: only packages of this kind were kept above, so `fake` may exist once for each kind.
    const duplicate = manifests.find((existing) => existing.code === code);
    if (duplicate !== undefined) {
      throw new Error(
        `${subject.capitalized} "${code}" is declared twice: ${duplicate.dir} and ${dir}.`,
      );
    }
    manifests.push({ dir, code, main: pkg.main ?? "dist/index.js" });
  }
  return manifests;
}

/**
 * Loads exactly the enabled provider packages of one kind (ADR 0029 decision 8, ADR 0031 decision 4), the way
 * `loadFeatures` loads features: providers are discovered on disk by their manifest
 * (`"fluxkit": {"provider": "<code>", "kind": "<kind>"}`) and imported dynamically, so neither core nor this app has a
 * static reference to any of them and deleting a provider folder never breaks the build. With nothing enabled the folder
 * is not even read. An enabled provider that is missing, whose entry point is broken or that does not export
 * `providerModule` fails loudly at startup; a disabled or deleted one has no effect. Shared by the shipping and the email
 * loader; the messages carry the kind, so each reads as before.
 */
export async function loadProviderPackages(
  options: LoadProviderPackagesOptions,
): Promise<LoadedProviderPackage[]> {
  if (options.enabled.length === 0) {
    return [];
  }
  const subject = subjectOf(options.kind);
  const manifests = await readManifests(options, subject);
  const loaded: LoadedProviderPackage[] = [];
  for (const code of new Set(options.enabled)) {
    const manifest = manifests.find((candidate) => candidate.code === code);
    if (manifest === undefined) {
      throw new Error(
        `${subject.capitalized} "${code}" is enabled in ${options.variable} but no package with "fluxkit": {"provider": "${code}", "kind": "${options.kind}"} was found in ${options.providersDir}.`,
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
        `${subject.capitalized} "${code}": "main" (${manifest.main}) must stay inside ${manifest.dir}.`,
      );
    }
    let imported: { providerModule?: Type<unknown> };
    try {
      imported = (await import(pathToFileURL(entryPath).href)) as typeof imported;
    } catch (error) {
      throw new Error(
        `${subject.capitalized} "${code}" could not be loaded from ${manifest.main}: ${(error as Error).message}`,
        { cause: error },
      );
    }
    if (typeof imported.providerModule !== "function") {
      throw new Error(
        `${subject.capitalized} "${code}" must export "providerModule" (a Nest module class) from ${manifest.main}.`,
      );
    }
    loaded.push({ code, module: imported.providerModule });
  }
  return loaded;
}
