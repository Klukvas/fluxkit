/**
 * The storefront's feature slices (plan docs/plans/2026-11-13-blog.md, E6): the generated list of the slices on disk
 * (`registry.generated.ts`, written by `scripts/generate-feature-registry.mjs` before `dev`, `build`, `typecheck` and `test`),
 * checked here once at load. App code reaches a slice only through this module; a slice is shown only while its name is in
 * `GET /store/config` `features` (`features/runtime.server.ts`).
 */
import { locales, type Locale } from "@fluxkit/ui";
import type { NavigationLink } from "../layout/navigation";
import { isPlainStorefrontPath } from "../lib/locale-path";
import { generatedFeatures } from "./registry.generated";
import type { FeatureLinkPlacement, RegisteredFeature, StorefrontFeature } from "./types";

/** The namespace of every feature's messages: `features.<name>.<key>`. */
export const FEATURES_NAMESPACE = "features";

const FEATURE_NAME = /^[a-z][a-z0-9-]*$/;
const PLACEMENTS: readonly FeatureLinkPlacement[] = ["header", "footer"];

/** The prefix of a feature's own message keys. */
export function featureMessagePrefix(name: string): string {
  return `${FEATURES_NAMESPACE}.${name}.`;
}

function messageProblems(feature: StorefrontFeature, locales: readonly Locale[]): string[] {
  const problems: string[] = [];
  const prefix = featureMessagePrefix(feature.name);
  const keySets = locales.map((locale) => Object.keys(feature.messages[locale] ?? {}).sort());
  locales.forEach((locale, index) => {
    const messages = feature.messages[locale];
    if (messages === undefined) {
      problems.push(`feature "${feature.name}" has no ${locale} messages`);
      return;
    }
    for (const [key, value] of Object.entries(messages)) {
      if (!key.startsWith(prefix) || key.length === prefix.length) {
        problems.push(
          `feature "${feature.name}": ${locale} message "${key}" is outside its namespace "${prefix}"`,
        );
      }
      if (typeof value !== "string" || value.trim() === "") {
        problems.push(
          `feature "${feature.name}": ${locale} message "${key}" must be a non-empty string`,
        );
      }
    }
    if (index > 0 && keySets[index]?.join("\n") !== keySets[0]?.join("\n")) {
      problems.push(
        `feature "${feature.name}": the ${locale} messages do not have the same keys as the ${locales[0] ?? ""} ones`,
      );
    }
  });
  return problems;
}

function navigationProblems(feature: StorefrontFeature, locales: readonly Locale[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const link of feature.navigation) {
    if (!PLACEMENTS.includes(link.placement)) {
      problems.push(
        `feature "${feature.name}": unknown link placement "${String(link.placement)}"`,
      );
    }
    if (!isPlainStorefrontPath(link.path)) {
      problems.push(
        `feature "${feature.name}": link "${link.path}" is not a plain storefront path`,
      );
    }
    for (const locale of locales) {
      if (!Object.hasOwn(feature.messages[locale] ?? {}, link.labelKey)) {
        problems.push(
          `feature "${feature.name}": link "${link.path}": message key "${link.labelKey}" is not among its ${locale} messages`,
        );
      }
    }
    const id = `${link.placement} ${link.path}`;
    if (seen.has(id)) {
      problems.push(
        `feature "${feature.name}": ${link.placement} link "${link.path}" is listed twice`,
      );
    }
    seen.add(id);
  }
  return problems;
}

/**
 * What is wrong with a list of registered slices (empty when nothing is): a manifest whose `name` is not its folder's, a name
 * that is not a feature name, a name listed twice, messages outside `features.<name>.`, empty or missing in a locale, and a link
 * whose path is not plain or whose label is not one of the feature's own messages.
 */
export function featureRegistryProblems(
  entries: readonly RegisteredFeature[],
  messageLocales: readonly Locale[] = locales,
): string[] {
  const problems: string[] = [];
  const names = new Set<string>();
  for (const { folder, feature } of entries) {
    if (feature.name !== folder) {
      problems.push(
        `the manifest of (feature-${folder}) is named "${feature.name}": a slice's name is its folder's`,
      );
    }
    if (!FEATURE_NAME.test(feature.name)) {
      problems.push(`"${feature.name}" is not a feature name (a-z, 0-9 and "-")`);
    }
    if (names.has(feature.name)) problems.push(`feature "${feature.name}" is registered twice`);
    names.add(feature.name);
    problems.push(...messageProblems(feature, messageLocales));
    problems.push(...navigationProblems(feature, messageLocales));
  }
  return problems;
}

/** Throws with every problem of the registered slices (see `featureRegistryProblems`). */
export function assertFeatureRegistry(entries: readonly RegisteredFeature[]): void {
  const problems = featureRegistryProblems(entries);
  if (problems.length > 0) {
    throw new Error(`The storefront feature slices are invalid: ${problems.join("; ")}`);
  }
}

function checkedFeatures(entries: readonly RegisteredFeature[]): readonly StorefrontFeature[] {
  assertFeatureRegistry(entries);
  return entries.map((entry) => entry.feature);
}

/** Every slice on disk, in name order, enabled or not. Checked at load: a broken manifest fails the build and every page. */
export const storefrontFeatures: readonly StorefrontFeature[] = checkedFeatures(generatedFeatures);

/** The slices whose name is in `enabled` (`GET /store/config` `features`), in registry order. */
export function enabledStorefrontFeatures(
  features: readonly StorefrontFeature[],
  enabled: readonly string[],
): StorefrontFeature[] {
  return features.filter((feature) => enabled.includes(feature.name));
}

/** The links of the enabled slices for one place, in registry order, as the header and the footer take them. */
export function featureNavigation(
  features: readonly StorefrontFeature[],
  enabled: readonly string[],
  placement: FeatureLinkPlacement,
): NavigationLink[] {
  return enabledStorefrontFeatures(features, enabled).flatMap((feature) =>
    feature.navigation
      .filter((link) => link.placement === placement)
      .map((link) => ({ labelKey: link.labelKey, href: link.path })),
  );
}
