import type { AdminOperationPermission } from "@fluxkit/api-client";
import type { Locale, Messages } from "@fluxkit/ui";
import type { ComponentType } from "react";
import type { FeatureMessageFile, LazyFile } from "../messages";

/*
 * The admin side of an optional feature (ADR 0049, extension point E8 of docs/plans/2026-11-13-blog.md). A feature slice is
 * one folder `src/features/<name>/` with a manifest `feature.ts` that exports `feature` (this shape); the registry
 * (`registry.ts`) finds it with `import.meta.glob`, and nothing else in the app imports the folder. Deleting the folder
 * removes the screens, their navigation entry and their messages; the rest of the admin is unchanged.
 */

/** The navigation groups a feature's entry may join (`layout/navigation.ts` lists them in this order). */
export const NAVIGATION_GROUP_IDS = ["catalog", "storefront", "sales", "settings", "help"] as const;
export type NavigationGroupId = (typeof NAVIGATION_GROUP_IDS)[number];

/** A route id of a feature screen: `feature.<name>.<screen>`. */
export type FeatureRouteId = `feature.${string}.${string}`;

/** A loaded feature screen: the page and the lazy message files it uses (its own `feature:<name>` and any core file). */
export interface FeaturePage {
  Component: ComponentType;
  messageFiles: readonly LazyFile[];
}

export interface FeatureRoute {
  id: FeatureRouteId;
  /** Relative to the SPA's base path; starts with `/features/<name>` so it never meets a core path. */
  path: string;
  /** What the role needs to open the screen (never `public`: a feature screen is for signed-in admins). */
  permission: Exclude<AdminOperationPermission, "public" | "denied">;
  /** A key of the feature's messages (`features.<name>.…`). */
  titleKey: string;
  /** A dynamic `import()` of the screen's module: the screens are their own chunk, never the entry. */
  load: () => Promise<FeaturePage>;
}

export interface FeatureNavigation {
  group: NavigationGroupId;
  /** A key of the feature's messages (`features.<name>.…`). */
  labelKey: string;
  /** One of the feature's route ids; the entry shows only when that route may be opened. */
  routeId: FeatureRouteId;
}

export interface AdminFeatureManifest {
  /** The feature's name in `FEATURES_ENABLED` and `GET /admin/config` `features`; equals the folder name. */
  name: string;
  routes: readonly FeatureRoute[];
  navigation: FeatureNavigation;
  /**
   * The feature's message file per UI language, as a dynamic import (`() => import("./messages/uk.json").then((module) =>
   * module.default)`), so it is a chunk of its own: every key starts with `features.<name>.`. The shell loads it once the API
   * says the feature is enabled, before the feature's entry or screen shows.
   */
  messages: Readonly<Record<Locale, () => Promise<Messages>>>;
}

/** The message file id of a feature in the i18n state (`messages/index.ts`). */
export function featureMessageFile(name: string): FeatureMessageFile {
  return `feature:${name}`;
}
