import type { Locale, Messages } from "@fluxkit/ui";
import { NAVIGATION_GROUP_IDS, type AdminFeatureManifest } from "./manifest";

/*
 * The rules a feature slice's manifest and messages must follow (ADR 0049, E8). Checked by the registry in development and
 * in the tests (`registry.spec.ts` runs them over every slice of the build); a production build leaves them out, because
 * the manifests and message files are static code that CI has already checked (entry budget, `build-output.spec.ts`).
 */

export const FEATURE_NAME = /^[a-z][a-z0-9-]{0,31}$/;
export const MANIFEST_PATH = /^\.\/([^/]+)\/feature\.ts$/;

/** A slice breaks a rule: a bug of the slice, never shown as "try again". */
export class FeatureSliceError extends Error {
  override name = "FeatureSliceError";
}

function fail(path: string, problem: string): never {
  throw new FeatureSliceError(`Admin feature manifest ${path}: ${problem}`);
}

/** Every route, title and label of `manifest` checked against the folder it was found in; throws naming the problem. */
export function checkManifest(path: string, manifest: AdminFeatureManifest | undefined): void {
  const folder = MANIFEST_PATH.exec(path)?.[1];
  if (folder === undefined) fail(path, "is not at ./<name>/feature.ts.");
  if (manifest === undefined) fail(path, "exports no `feature`.");
  const { name } = manifest;
  if (name !== folder) fail(path, `name "${name}" must equal its folder name "${folder}".`);
  if (!FEATURE_NAME.test(name)) fail(path, `name "${name}" must match ${String(FEATURE_NAME)}.`);
  const keyPrefix = `features.${name}.`;
  const pathPrefix = `/features/${name}`;
  if (manifest.routes.length === 0) fail(path, "declares no route.");
  for (const route of manifest.routes) {
    if (!route.id.startsWith(`feature.${name}.`) || route.id.split(".").length !== 3) {
      fail(path, `route id "${route.id}" must be "feature.${name}.<screen>".`);
    }
    if (route.path !== pathPrefix && !route.path.startsWith(`${pathPrefix}/`)) {
      fail(path, `route path "${route.path}" must start with "${pathPrefix}".`);
    }
    if (!route.titleKey.startsWith(keyPrefix)) {
      fail(path, `title key "${route.titleKey}" must start with "${keyPrefix}".`);
    }
  }
  const ids = manifest.routes.map((route) => route.id);
  if (new Set(ids).size !== ids.length) fail(path, "has two routes with the same id.");
  const paths = manifest.routes.map((route) => route.path);
  if (new Set(paths).size !== paths.length) fail(path, "has two routes with the same path.");
  const { navigation } = manifest;
  if (!(NAVIGATION_GROUP_IDS as readonly string[]).includes(navigation.group)) {
    fail(
      path,
      `navigation group "${navigation.group}" is not one of ${NAVIGATION_GROUP_IDS.join(", ")}.`,
    );
  }
  if (!navigation.labelKey.startsWith(keyPrefix)) {
    fail(path, `navigation label "${navigation.labelKey}" must start with "${keyPrefix}".`);
  }
  if (!ids.includes(navigation.routeId)) {
    fail(path, `navigation names "${navigation.routeId}", which is not one of its routes.`);
  }
}

/**
 * A feature's messages: every key starts with `features.<name>.` (a key outside the namespace could shadow a core key)
 * and every value is a non-empty string. Throws naming the key.
 */
export function checkFeatureMessages(name: string, locale: Locale, messages: Messages): void {
  const prefix = `features.${name}.`;
  for (const [key, value] of Object.entries(messages)) {
    if (!key.startsWith(prefix)) {
      throw new FeatureSliceError(
        `Message "${key}" of feature ${name} (${locale}) must start with "${prefix}".`,
      );
    }
    if (typeof value !== "string" || value.trim() === "") {
      throw new FeatureSliceError(
        `Message "${key}" of feature ${name} (${locale}) must be a non-empty string.`,
      );
    }
  }
}
