import { ROLE_PERMISSIONS } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import { routeById } from "../routes";
import { NAVIGATION, visibleNavigation } from "./navigation";

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
    for (const group of visibleNavigation([...ROLE_PERMISSIONS.owner])) {
      for (const item of group.items) {
        expect(item.href).toBe(routeById(item.routeId).path);
        expect(item.permission).toBe(routeById(item.routeId).permission);
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
