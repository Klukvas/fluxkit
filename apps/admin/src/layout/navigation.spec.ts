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
      "orders",
      "customers",
      "payments",
      "shipping",
      "email",
      "privacy",
      "auditLog",
      "users",
    ]);
    for (const group of visibleNavigation([...ROLE_PERMISSIONS.owner])) {
      for (const item of group.items) {
        expect(item.href).toBe(routeById(item.routeId).path);
        expect(item.permission).toBe(routeById(item.routeId).permission);
      }
    }
  });

  it("shows the viewer the catalog only", () => {
    expect(ids([...ROLE_PERMISSIONS.viewer])).toEqual([
      "products",
      "attributes",
      "options",
      "productTypes",
      "brands",
      "categories",
    ]);
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
    expect(ids(["shipping.manage"])).toEqual(["shipping"]);
    expect(visibleNavigation(["shipping.manage"]).map((group) => group.id)).toEqual(["settings"]);
  });

  it("shows the Email area to a session with email.manage only: owner and manager, never the viewer, never through shipping.manage or orders", () => {
    expect(ids([...ROLE_PERMISSIONS.owner])).toContain("email");
    expect(ids([...ROLE_PERMISSIONS.manager])).toContain("email");
    expect(ids([...ROLE_PERMISSIONS.viewer])).not.toContain("email");
    expect(ids(["shipping.manage", "orders.read", "orders.write", "users.manage"])).not.toContain(
      "email",
    );
    expect(ids(["email.manage"])).toEqual(["email"]);
    expect(visibleNavigation(["email.manage"]).map((group) => group.id)).toEqual(["settings"]);
  });

  it("shows the payment attention list to a session that reads orders: owner and manager, never the viewer, never through the refund permission alone", () => {
    expect(ids([...ROLE_PERMISSIONS.owner])).toContain("payments");
    expect(ids([...ROLE_PERMISSIONS.manager])).toContain("payments");
    expect(ids([...ROLE_PERMISSIONS.viewer])).not.toContain("payments");
    expect(ids(["payments.refund", "shipping.manage", "email.manage"])).not.toContain("payments");
    expect(ids(["orders.read"])).toEqual(["orders", "payments"]);
    expect(visibleNavigation(["orders.read"]).map((group) => group.id)).toEqual(["sales"]);
  });

  it("shows the owner everything, and drops groups that end up empty", () => {
    expect(ids([...ROLE_PERMISSIONS.owner])).toContain("users");
    expect(ids([...ROLE_PERMISSIONS.owner])).toContain("shipping");
    expect(visibleNavigation([]).length).toBe(0);
    expect(visibleNavigation(["orders.read"]).map((group) => group.id)).toEqual(["sales"]);
  });
});
