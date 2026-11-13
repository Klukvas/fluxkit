import type { AdminOperationPermission } from "@fluxkit/api-client";
import type { FeatureRouteId, NavigationGroupId } from "../features/manifest";
import { ADMIN_FEATURES } from "../features/registry";
import { canAccess } from "../permissions";
import type { RouteId } from "../router/paths";
import { featureRouteById, routeById } from "../routes";

import type { ComponentType } from "react";
import {
  ExtensionIcon,
  HomeIcon,
  OrdersIcon,
  ProductsIcon,
  CustomersIcon,
  PaymentsIcon,
  CategoriesIcon,
  BrandsIcon,
  ProductTypesIcon,
  AttributesIcon,
  OptionsIcon,
  BannersIcon,
  SearchIcon,
  ShippingIcon,
  EmailIcon,
  PersonalDataIcon,
  AuditLogIcon,
  AdministratorsIcon,
  HelpIcon,
  type IconProps,
} from "@fluxkit/ui";

export interface NavigationItemConfig {
  routeId: RouteId;
  icon: ComponentType<IconProps>;
}
export interface NavigationGroupConfig {
  id: NavigationGroupId;
  headingKey?: string;
  placement?: "main" | "bottom";
  items: readonly NavigationItemConfig[];
}

/** Internal layout configuration; route definitions remain the source of paths and permissions. */
export const NAVIGATION: readonly NavigationGroupConfig[] = [
  {
    id: "sales",
    items: [
      { routeId: "home", icon: HomeIcon },
      { routeId: "orders", icon: OrdersIcon },
      { routeId: "products", icon: ProductsIcon },
      { routeId: "customers", icon: CustomersIcon },
      { routeId: "payments", icon: PaymentsIcon },
    ],
  },
  {
    id: "catalog",
    headingKey: "nav.group.catalogSetup",
    items: [
      { routeId: "categories", icon: CategoriesIcon },
      { routeId: "brands", icon: BrandsIcon },
      { routeId: "productTypes", icon: ProductTypesIcon },
      { routeId: "attributes", icon: AttributesIcon },
      { routeId: "options", icon: OptionsIcon },
    ],
  },
  {
    id: "storefront",
    headingKey: "nav.group.storefront",
    items: [
      { routeId: "banners", icon: BannersIcon },
      { routeId: "search", icon: SearchIcon },
    ],
  },
  {
    id: "settings",
    headingKey: "nav.group.settings",
    items: [
      { routeId: "shipping", icon: ShippingIcon },
      { routeId: "email", icon: EmailIcon },
      { routeId: "privacy", icon: PersonalDataIcon },
      { routeId: "auditLog", icon: AuditLogIcon },
      { routeId: "users", icon: AdministratorsIcon },
    ],
  },
  { id: "help", placement: "bottom", items: [{ routeId: "help", icon: HelpIcon }] },
];

export interface NavigationItem {
  routeId: RouteId | FeatureRouteId;
  icon: ComponentType<IconProps>;
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
      icon: ExtensionIcon,
      feature: feature.name,
      group: feature.navigation.group,
      routeId: route.id,
      labelKey: feature.navigation.labelKey,
      href: route.path,
      permission: route.permission,
    };
  },
);

export interface NavigationGroup extends Omit<NavigationGroupConfig, "items"> {
  items: NavigationItem[];
}

function featureItems(
  group: NavigationGroupId,
  enabledFeatures: readonly string[],
  entries: readonly FeatureNavigationEntry[],
): NavigationItem[] {
  return entries
    .filter((entry) => entry.group === group && enabledFeatures.includes(entry.feature))
    .map(({ routeId, labelKey, href, permission }) => ({
      routeId,
      labelKey,
      href,
      permission,
      icon: ExtensionIcon,
    }));
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
    ...group,
    items: [
      ...group.items.map((item) => {
        const route = routeById(item.routeId);
        return {
          ...item,
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
