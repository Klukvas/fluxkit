import type { AdminOperationPermission } from "@fluxkit/api-client";
import { canAccess } from "../permissions";
import type { RouteId } from "../router/paths";
import { routeById } from "../routes";

/**
 * The side navigation as configuration (plan, "Theming and layout composition"): groups in order, each with a heading
 * message key and items that name a route. The label, path and permission of an item come from the route table, so the
 * navigation cannot show a link the route would refuse. Internal in v1 (no registry for feature modules yet).
 */
export interface NavigationGroupConfig {
  id: string;
  headingKey: string;
  items: readonly RouteId[];
}

export const NAVIGATION: readonly NavigationGroupConfig[] = [
  {
    id: "catalog",
    headingKey: "nav.group.catalog",
    items: ["products", "attributes", "options", "productTypes", "brands", "categories"],
  },
  { id: "sales", headingKey: "nav.group.sales", items: ["orders", "customers"] },
  { id: "settings", headingKey: "nav.group.settings", items: ["shipping", "email", "users"] },
];

export interface NavigationItem {
  routeId: RouteId;
  labelKey: string;
  href: string;
  permission: AdminOperationPermission;
}

export interface NavigationGroup {
  id: string;
  headingKey: string;
  items: NavigationItem[];
}

/** The groups and items the admin with `permissions` may open; empty groups are dropped. */
export function visibleNavigation(permissions: readonly string[] | null): NavigationGroup[] {
  return NAVIGATION.map((group) => ({
    id: group.id,
    headingKey: group.headingKey,
    items: group.items
      .map((id) => routeById(id))
      .filter((route) => canAccess(permissions, route.permission))
      .map((route) => ({
        routeId: route.id,
        labelKey: route.titleKey,
        href: route.path,
        permission: route.permission,
      })),
  })).filter((group) => group.items.length > 0);
}

/** Whether a navigation item is the current page (its path, or a page below it). */
export function isCurrentPath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
