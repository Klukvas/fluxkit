import { ROLE_PERMISSIONS } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import { visibleNavigation } from "../../layout/navigation";
import { canAccess } from "../../permissions";
import { ROUTES } from "../../routes";
import { SHIPPING_WRITE_OPERATIONS, canManageShipping } from "./shipping-permissions";

const SHIPPING_ROUTE_IDS = [
  "shipping",
  "shippingMethodNew",
  "shippingMethodDetail",
  "shippingProviders",
  "shippingProviderDetail",
];

/**
 * The permission table of the Shipping area, per role (ADR 0009 roles, ADR 0029 decision 13): the navigation entry, the
 * five routes and the write controls. Written by hand, not derived from the code under test; the viewer holds neither
 * shipping.manage nor an order permission.
 */
const TABLE = {
  owner: { navigation: true, routes: true, writes: true },
  manager: { navigation: true, routes: true, writes: true },
  viewer: { navigation: false, routes: false, writes: false },
} as const;

describe("the Shipping area per role", () => {
  for (const role of ["owner", "manager", "viewer"] as const) {
    it(`${role}: navigation ${String(TABLE[role].navigation)}, routes ${String(TABLE[role].routes)}, writes ${String(TABLE[role].writes)}`, () => {
      const permissions = [...ROLE_PERMISSIONS[role]];
      const items = visibleNavigation(permissions).flatMap((group) =>
        group.items.map((i) => i.routeId),
      );
      expect(items.includes("shipping")).toBe(TABLE[role].navigation);
      for (const id of SHIPPING_ROUTE_IDS) {
        const route = ROUTES.find((entry) => entry.id === id);
        expect(route, id).toBeDefined();
        expect(canAccess(permissions, route?.permission ?? "denied"), `${role} ${id}`).toBe(
          TABLE[role].routes,
        );
      }
      expect(canManageShipping(permissions)).toBe(TABLE[role].writes);
    });
  }

  it("is default-deny: no session, an empty permission list and unrelated permissions reach nothing", () => {
    for (const permissions of [
      null,
      [],
      ["orders.read", "orders.write", "catalog.write", "users.manage"],
    ]) {
      expect(canManageShipping(permissions)).toBe(false);
      for (const id of SHIPPING_ROUTE_IDS) {
        const route = ROUTES.find((entry) => entry.id === id);
        expect(canAccess(permissions, route?.permission ?? "denied"), id).toBe(false);
      }
      expect(
        visibleNavigation(permissions).flatMap((g) => g.items.map((i) => i.routeId)),
      ).not.toContain("shipping");
    }
  });

  it("needs every write operation: one missing permission turns the controls off", () => {
    expect(SHIPPING_WRITE_OPERATIONS.length).toBeGreaterThanOrEqual(5);
    expect(canManageShipping(["shipping.manage"])).toBe(true);
    expect(canManageShipping(["shipping.read"])).toBe(false);
  });
});
