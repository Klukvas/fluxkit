import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_PERMISSIONS } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import type { RouteId } from "../router/paths";
import { FEATURE_ROUTES, routeById } from "../routes";
import {
  FEATURE_NAVIGATION,
  NAVIGATION,
  visibleNavigation,
  type FeatureNavigationEntry,
} from "./navigation";

const ids = (permissions: readonly string[]) =>
  visibleNavigation(permissions).flatMap((group) => group.items.map((item) => item.routeId));

describe("navigation configuration", () => {
  it("lists every area once and takes each item's path and permission from the route table", () => {
    const items = NAVIGATION.flatMap((group) => group.items);
    expect(new Set(items).size).toBe(items.length);
    expect(items).toEqual([
      "products",
      "attributes",
      "options",
      "productTypes",
      "brands",
      "categories",
      "search",
      "banners",
      "orders",
      "customers",
      "payments",
      "shipping",
      "email",
      "privacy",
      "auditLog",
      "users",
      "help",
    ]);
    // No feature is enabled here, so every item is a core route.
    for (const group of visibleNavigation([...ROLE_PERMISSIONS.owner])) {
      for (const item of group.items) {
        const route = routeById(item.routeId as RouteId);
        expect(item.href).toBe(route.path);
        expect(item.permission).toBe(route.permission);
      }
    }
  });

  it("shows the viewer the catalog and the home banners only (both read with catalog.read)", () => {
    expect(ids([...ROLE_PERMISSIONS.viewer])).toEqual([
      "products",
      "attributes",
      "options",
      "productTypes",
      "brands",
      "categories",
      "search",
      "banners",
      "help",
    ]);
  });

  it("shows Help to every signed-in admin, whatever the permissions, and to nobody signed out", () => {
    for (const role of ["owner", "manager", "viewer"] as const) {
      expect(ids([...ROLE_PERMISSIONS[role]]), role).toContain("help");
    }
    expect(visibleNavigation([]).map((group) => group.id)).toEqual(["help"]);
    expect(visibleNavigation(null)).toEqual([]);
  });

  it("shows the manager everything but the users", () => {
    expect(ids([...ROLE_PERMISSIONS.manager])).not.toContain("users");
    expect(ids([...ROLE_PERMISSIONS.manager])).toContain("orders");
    expect(ids([...ROLE_PERMISSIONS.manager])).toContain("customers");
    expect(ids([...ROLE_PERMISSIONS.manager])).toContain("shipping");
  });

  it("shows the Shipping area to a session with shipping.manage only: never to the viewer, never through orders.write", () => {
    expect(ids([...ROLE_PERMISSIONS.viewer])).not.toContain("shipping");
    expect(ids(["orders.read", "orders.write", "customers.read"])).not.toContain("shipping");
    expect(ids(["shipping.manage"])).toEqual(["shipping", "help"]);
    expect(visibleNavigation(["shipping.manage"]).map((group) => group.id)).toEqual([
      "settings",
      "help",
    ]);
  });

  it("shows the Email area to a session with email.manage only: owner and manager, never the viewer, never through shipping.manage or orders", () => {
    expect(ids([...ROLE_PERMISSIONS.owner])).toContain("email");
    expect(ids([...ROLE_PERMISSIONS.manager])).toContain("email");
    expect(ids([...ROLE_PERMISSIONS.viewer])).not.toContain("email");
    expect(ids(["shipping.manage", "orders.read", "orders.write", "users.manage"])).not.toContain(
      "email",
    );
    expect(ids(["email.manage"])).toEqual(["email", "help"]);
    expect(visibleNavigation(["email.manage"]).map((group) => group.id)).toEqual([
      "settings",
      "help",
    ]);
  });

  it("shows the payment attention list to a session that reads orders: owner and manager, never the viewer, never through the refund permission alone", () => {
    expect(ids([...ROLE_PERMISSIONS.owner])).toContain("payments");
    expect(ids([...ROLE_PERMISSIONS.manager])).toContain("payments");
    expect(ids([...ROLE_PERMISSIONS.viewer])).not.toContain("payments");
    expect(ids(["payments.refund", "shipping.manage", "email.manage"])).not.toContain("payments");
    expect(ids(["orders.read"])).toEqual(["orders", "payments", "help"]);
    expect(visibleNavigation(["orders.read"]).map((group) => group.id)).toEqual(["sales", "help"]);
  });

  it("shows the owner everything, and drops groups that end up empty", () => {
    expect(ids([...ROLE_PERMISSIONS.owner])).toContain("users");
    expect(ids([...ROLE_PERMISSIONS.owner])).toContain("shipping");
    // Help is the only group of a session without permissions; every other group is dropped.
    expect(visibleNavigation([]).map((group) => group.id)).toEqual(["help"]);
    expect(visibleNavigation(["orders.read"]).map((group) => group.id)).toEqual(["sales", "help"]);
  });

  it("shows Home banners to every role that reads the catalog, in its own Storefront group after the catalog", () => {
    for (const role of ["owner", "manager", "viewer"] as const) {
      expect(ids([...ROLE_PERMISSIONS[role]]), role).toContain("banners");
    }
    expect(visibleNavigation(["catalog.read"]).map((group) => group.id)).toEqual([
      "catalog",
      "storefront",
      "help",
    ]);
    expect(ids(["orders.read", "shipping.manage"])).not.toContain("banners");
  });
});

describe("feature slice entries (ADR 0049, E8)", () => {
  // A fixture entry, so the core spec holds without any slice folder (the feature matrix deletes them).
  const notes: FeatureNavigationEntry = {
    feature: "notes",
    group: "storefront",
    routeId: "feature.notes.list",
    labelKey: "features.notes.nav",
    href: "/features/notes",
    permission: "catalog.read",
  };
  const withFeatures = (
    permissions: readonly string[],
    enabled: readonly string[],
    entries: readonly FeatureNavigationEntry[] = [notes],
  ) =>
    visibleNavigation(permissions, enabled, entries).flatMap((group) =>
      group.items.map((item) => `${group.id}:${item.routeId}`),
    );

  it("takes each slice's entry from its manifest, with the path and permission of the route it names", () => {
    for (const entry of FEATURE_NAVIGATION) {
      const route = FEATURE_ROUTES.find((candidate) => candidate.id === entry.routeId);
      expect(route?.feature, entry.routeId).toBe(entry.feature);
      expect(entry.href).toBe(route?.path);
      expect(entry.permission).toBe(route?.permission);
    }
  });

  it("shows a feature's entry only while the API lists the feature, after the group's own items", () => {
    const owner = [...ROLE_PERMISSIONS.owner];
    expect(withFeatures(owner, [])).not.toContain("storefront:feature.notes.list");
    expect(withFeatures(owner, ["example"])).not.toContain("storefront:feature.notes.list");
    expect(withFeatures(owner, ["notes"]).filter((id) => id.startsWith("storefront:"))).toEqual([
      "storefront:banners",
      "storefront:feature.notes.list",
    ]);
    const item = visibleNavigation(owner, ["notes"], [notes])
      .flatMap((group) => group.items)
      .find((entry) => entry.routeId === "feature.notes.list");
    expect(item).toEqual({
      routeId: "feature.notes.list",
      labelKey: "features.notes.nav",
      href: "/features/notes",
      permission: "catalog.read",
    });
  });

  it("follows the entry's permission", () => {
    expect(withFeatures([...ROLE_PERMISSIONS.viewer], ["notes"])).toContain(
      "storefront:feature.notes.list",
    );
    expect(withFeatures(["orders.read"], ["notes"])).not.toContain("storefront:feature.notes.list");
    expect(withFeatures([], ["notes"])).toEqual(["help:help"]);
  });

  it("joins the group a manifest names, even one with no core item for the role", () => {
    const sales = { ...notes, group: "sales" } as const;
    expect(
      visibleNavigation(["catalog.read"], ["notes"], [sales]).map((group) => group.id),
    ).toEqual(["catalog", "storefront", "sales", "help"]);
  });
});

describe("the small-screen menu (source guard)", () => {
  it("closes on every navigation, a link to the page already shown included (location.key, not the path)", () => {
    const shell = readFileSync(join(import.meta.dirname, "shell.tsx"), "utf8");
    expect(shell).toMatch(/navigationKey=\{location\.key\}/);
    expect(shell).toMatch(
      /useEffect\(\(\) => \{\s*setMenuOpen\(false\);\s*\}, \[navigationKey\]\);/,
    );
  });
});
