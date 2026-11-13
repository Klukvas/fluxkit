import type { AdminOperationPermission } from "@fluxkit/api-client";
import type { FeatureRouteId, NavigationGroupId } from "../features/manifest";
import { ADMIN_FEATURES } from "../features/registry";
import { canAccess } from "../permissions";
import type { RouteId } from "../router/paths";
import { featureRouteById, routeById } from "../routes";

/**
 * The side navigation as configuration (plan, "Theming and layout composition"): groups in order, each with a heading
 * message key and items that name a route. The label, path and permission of an item come from the route table, so the
 * navigation cannot show a link the route would refuse. A feature slice adds its one entry at the end of the group its
 * manifest names (`features/manifest.ts`, ADR 0049), shown only while the API lists the feature as enabled.
 */
export interface NavigationGroupConfig {
  id: NavigationGroupId;
  headingKey: string;
  items: readonly RouteId[];
}

export const NAVIGATION: readonly NavigationGroupConfig[] = [
  {
    id: "catalog",
    headingKey: "nav.group.catalog",
    items: ["products", "attributes", "options", "productTypes", "brands", "categories", "search"],
  },
  // What the shop shows besides the catalog (plan 2026-11-05-admin-home-banners.md, D5); catalog.read, like the catalog.
  { id: "storefront", headingKey: "nav.group.storefront", items: ["banners"] },
  { id: "sales", headingKey: "nav.group.sales", items: ["orders", "customers", "payments"] },
  {
    id: "settings",
    headingKey: "nav.group.settings",
    items: ["shipping", "email", "privacy", "auditLog", "users"],
  },
  // Every signed-in role (the route's permission is the session's), so this group is never empty.
  { id: "help", headingKey: "nav.group.help", items: ["help"] },
];

export interface NavigationItem {
  routeId: RouteId | FeatureRouteId;
  labelKey: string;
  href: string;
  permission: AdminOperationPermission;
}

/** A feature's entry (its manifest's `navigation`, with the path and permission of the route it names). */
export interface FeatureNavigationEntry extends NavigationItem {
  routeId: FeatureRouteId;
  feature: string;
  group: NavigationGroupId;
}

/** The entries of this build's feature slices. */
export const FEATURE_NAVIGATION: readonly FeatureNavigationEntry[] = ADMIN_FEATURES.map(
  (feature) => {
    const route = featureRouteById(feature.navigation.routeId);
    return {
      feature: feature.name,
      group: feature.navigation.group,
      routeId: route.id,
      labelKey: feature.navigation.labelKey,
      href: route.path,
      permission: route.permission,
    };
  },
);

export interface NavigationGroup {
  id: NavigationGroupId;
  headingKey: string;
  items: NavigationItem[];
}

function featureItems(
  group: NavigationGroupId,
  enabledFeatures: readonly string[],
  entries: readonly FeatureNavigationEntry[],
): NavigationItem[] {
  return entries
    .filter((entry) => entry.group === group && enabledFeatures.includes(entry.feature))
    .map(({ routeId, labelKey, href, permission }) => ({ routeId, labelKey, href, permission }));
}

/**
 * The groups and items the admin with `permissions` may open; empty groups are dropped. `enabledFeatures` are the
 * features whose messages are loaded and which the API lists (`GET /admin/config` `features`); none while unknown.
 */
export function visibleNavigation(
  permissions: readonly string[] | null,
  enabledFeatures: readonly string[] = [],
  entries: readonly FeatureNavigationEntry[] = FEATURE_NAVIGATION,
): NavigationGroup[] {
  return NAVIGATION.map((group) => ({
    id: group.id,
    headingKey: group.headingKey,
    items: [
      ...group.items.map((id) => {
        const route = routeById(id);
        return {
          routeId: route.id,
          labelKey: route.titleKey,
          href: route.path,
          permission: route.permission,
        };
      }),
      ...featureItems(group.id, enabledFeatures, entries),
    ].filter((item) => canAccess(permissions, item.permission)),
  })).filter((group) => group.items.length > 0);
}

/** Whether a navigation item is the current page (its path, or a page below it). */
export function isCurrentPath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
