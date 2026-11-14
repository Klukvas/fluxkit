import type { Locale } from "@fluxkit/ui";
import type { FeatureMessageFile, FileLoader } from "../messages";
import { featureMessageFile, type AdminFeatureManifest } from "./manifest";
import { checkFeatureMessages, checkManifest } from "./manifest-rules";

/*
 * The admin feature registry (ADR 0049, E8): the ONLY module of the app that reaches into `src/features/<name>/`
 * (dependency-cruiser rule `admin-must-not-import-feature-slices`; the glob below is the reach). It finds every
 * `./<name>/feature.ts` with Vite's `import.meta.glob`; the manifests are small and eager (the route table and the navigation
 * are built before the first render), everything else of a feature (screens, messages) is a dynamic import of its own
 * chunk. With no feature folder the list is empty and the admin is exactly the core admin.
 *
 * The rules of `manifest-rules.ts` run in development and in the tests (`registry.spec.ts` checks every slice of the
 * build); a production build leaves them out: the manifests and message files are static code CI has checked, and the
 * entry chunk has a budget (`build-output.spec.ts`).
 */

/** A manifest file as the glob returns it: the module of `./<name>/feature.ts`. */
export type ManifestModules = Readonly<Record<string, { feature?: AdminFeatureManifest }>>;

/** The manifests of the found modules, sorted by name (checked in development). */
export function featuresFrom(modules: ManifestModules): readonly AdminFeatureManifest[] {
  const found = Object.entries(modules).map(([path, module]) => {
    if (import.meta.env.DEV) checkManifest(path, module.feature);
    return module.feature as AdminFeatureManifest;
  });
  return found.sort((first, second) => first.name.localeCompare(second.name));
}

/** The message loaders of the features, by their file id (`feature:<name>`), for `createFileLoader`. */
export function featureMessageLoaders(
  features: readonly AdminFeatureManifest[],
): Record<FeatureMessageFile, Record<Locale, FileLoader>> {
  const loaders: Record<FeatureMessageFile, Record<Locale, FileLoader>> = {};
  for (const feature of features) {
    const byLocale =
      (locale: Locale): FileLoader =>
      () =>
        feature.messages[locale]().then((messages) => {
          if (import.meta.env.DEV) checkFeatureMessages(feature.name, locale, messages);
          return messages;
        });
    loaders[featureMessageFile(feature.name)] = { uk: byLocale("uk"), en: byLocale("en") };
  }
  return loaders;
}

/** The feature slices of this build. */
export const ADMIN_FEATURES: readonly AdminFeatureManifest[] = featuresFrom(
  import.meta.glob<{ feature?: AdminFeatureManifest }>("./*/feature.ts", { eager: true }),
);
