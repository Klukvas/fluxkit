import { ROLE_PERMISSIONS } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import { visibleNavigation } from "../../layout/navigation";
import { canAccess } from "../../permissions";
import { ROUTES } from "../../routes";
import { PRIVACY_WRITE_OPERATIONS, canManagePrivacy } from "./privacy-permissions";

const PRIVACY_ROUTE_IDS = ["privacy", "privacyLookup", "privacyRequestDetail"];

/**
 * The permission table of the Privacy area and the audit log, per role (ADR 0033 decision 9: `privacy.manage` and
 * `users.manage` are owner only). Written by hand, not derived from the code under test. A manager can read customers and
 * orders but is not the accountable person for an erasure.
 */
const TABLE = {
  owner: { privacyNavigation: true, auditNavigation: true, routes: true, writes: true },
  manager: { privacyNavigation: false, auditNavigation: false, routes: false, writes: false },
  viewer: { privacyNavigation: false, auditNavigation: false, routes: false, writes: false },
} as const;

describe("the Privacy area and the audit log per role", () => {
  for (const role of ["owner", "manager", "viewer"] as const) {
    it(`${role}: privacy navigation ${String(TABLE[role].privacyNavigation)}, audit navigation ${String(TABLE[role].auditNavigation)}, routes ${String(TABLE[role].routes)}, writes ${String(TABLE[role].writes)}`, () => {
      const permissions = [...ROLE_PERMISSIONS[role]];
      const items = visibleNavigation(permissions).flatMap((group) =>
        group.items.map((item) => item.routeId),
      );
      expect(items.includes("privacy")).toBe(TABLE[role].privacyNavigation);
      expect(items.includes("auditLog")).toBe(TABLE[role].auditNavigation);
      for (const id of [...PRIVACY_ROUTE_IDS, "auditLog"]) {
        const route = ROUTES.find((entry) => entry.id === id);
        expect(route, id).toBeDefined();
        expect(canAccess(permissions, route?.permission ?? "denied"), `${role} ${id}`).toBe(
          TABLE[role].routes,
        );
      }
      expect(canManagePrivacy(permissions)).toBe(TABLE[role].writes);
    });
  }

  it("guards the privacy routes with privacy.manage and the audit log with users.manage", () => {
    for (const id of PRIVACY_ROUTE_IDS) {
      expect(ROUTES.find((entry) => entry.id === id)?.permission, id).toBe("privacy.manage");
    }
    expect(ROUTES.find((entry) => entry.id === "auditLog")?.permission).toBe("users.manage");
  });

  it("shows the Privacy entry to a session with privacy.manage only, never through another permission", () => {
    const ids = (permissions: readonly string[]) =>
      visibleNavigation(permissions).flatMap((group) => group.items.map((item) => item.routeId));
    expect(ids(["privacy.manage"])).toEqual(["privacy"]);
    expect(ids(["customers.read", "customers.write", "orders.read", "email.manage"])).not.toContain(
      "privacy",
    );
    expect(ids(["users.manage"])).toContain("auditLog");
    expect(ids(["users.manage"])).not.toContain("privacy");
  });

  it("needs privacy.manage for every call and for nothing less", () => {
    expect([...PRIVACY_WRITE_OPERATIONS].sort()).toEqual(
      [
        "createPrivacyRequest",
        "erasePrivacyRequest",
        "exportPrivacyRequest",
        "previewPrivacyErasure",
        "privacyLookup",
        "rejectPrivacyRequest",
      ].sort(),
    );
    expect(canManagePrivacy(["privacy.manage"])).toBe(true);
    expect(canManagePrivacy(["users.manage", "customers.write", "orders.write"])).toBe(false);
    expect(canManagePrivacy([])).toBe(false);
    expect(canManagePrivacy(null)).toBe(false);
  });
});
