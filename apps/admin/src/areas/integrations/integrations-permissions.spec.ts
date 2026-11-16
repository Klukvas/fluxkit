import { ROLE_PERMISSIONS } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import { visibleNavigation } from "../../layout/navigation";
import { canAccess } from "../../permissions";
import { ROUTES } from "../../routes";
import { INTEGRATION_WRITE_OPERATIONS, canManageIntegrations } from "./integrations-permissions";

/**
 * The permission table of the Integrations area, per role (ADR 0058): the navigation entry, the route and the write
 * controls. Written by hand, not derived from the code under test. Only the owner handles provider credentials.
 */
const TABLE = {
  owner: true,
  manager: false,
  viewer: false,
} as const;

describe("the Integrations area per role", () => {
  for (const role of ["owner", "manager", "viewer"] as const) {
    it(`${role}: navigation, route and writes ${String(TABLE[role])}`, () => {
      const permissions = [...ROLE_PERMISSIONS[role]];
      const items = visibleNavigation(permissions).flatMap((group) =>
        group.items.map((item) => item.routeId),
      );
      expect(items.includes("integrations")).toBe(TABLE[role]);
      const route = ROUTES.find((entry) => entry.id === "integrations");
      expect(route?.permission).toBe("integrations.manage");
      expect(canAccess(permissions, route?.permission ?? "denied")).toBe(TABLE[role]);
      expect(canManageIntegrations(permissions)).toBe(TABLE[role]);
    });
  }

  it("is not opened by any other permission, and by nothing without a session", () => {
    const others = ROLE_PERMISSIONS.owner.filter((name) => name !== "integrations.manage");
    expect(canManageIntegrations([...others])).toBe(false);
    expect(
      visibleNavigation([...others])
        .flatMap((group) => group.items.map((item) => item.routeId))
        .includes("integrations"),
    ).toBe(false);
    expect(canManageIntegrations(null)).toBe(false);
  });

  it("names both writes of the screen", () => {
    expect([...INTEGRATION_WRITE_OPERATIONS].sort()).toEqual([
      "putIntegrationSecret",
      "retireIntegrationSecret",
    ]);
  });
});
