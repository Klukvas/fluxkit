import { ROLE_PERMISSIONS } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import { visibleNavigation } from "../../layout/navigation";
import { canAccess } from "../../permissions";
import { ROUTES } from "../../routes";
import { EMAIL_WRITE_OPERATIONS, canManageEmail } from "./email-permissions";

const EMAIL_ROUTE_IDS = [
  "email",
  "emailMessages",
  "emailMessageDetail",
  "emailTemplates",
  "emailTemplatePreview",
];

/**
 * The permission table of the Email area, per role (ADR 0031 decision 15): the navigation entry, the five routes and the
 * write controls. Written by hand, not derived from the code under test. The viewer has no customer data, so no mail
 * addresses either.
 */
const TABLE = {
  owner: { navigation: true, routes: true, writes: true },
  manager: { navigation: true, routes: true, writes: true },
  viewer: { navigation: false, routes: false, writes: false },
} as const;

describe("the Email area per role", () => {
  for (const role of ["owner", "manager", "viewer"] as const) {
    it(`${role}: navigation ${String(TABLE[role].navigation)}, routes ${String(TABLE[role].routes)}, writes ${String(TABLE[role].writes)}`, () => {
      const permissions = [...ROLE_PERMISSIONS[role]];
      const items = visibleNavigation(permissions).flatMap((group) =>
        group.items.map((item) => item.routeId),
      );
      expect(items.includes("email")).toBe(TABLE[role].navigation);
      for (const id of EMAIL_ROUTE_IDS) {
        const route = ROUTES.find((entry) => entry.id === id);
        expect(route, id).toBeDefined();
        expect(canAccess(permissions, route?.permission ?? "denied"), `${role} ${id}`).toBe(
          TABLE[role].routes,
        );
      }
      expect(canManageEmail(permissions)).toBe(TABLE[role].writes);
    });
  }

  it("guards every email route with email.manage, reads included (the outbox shows addresses)", () => {
    for (const id of EMAIL_ROUTE_IDS) {
      expect(ROUTES.find((entry) => entry.id === id)?.permission, id).toBe("email.manage");
    }
  });

  it("needs email.manage for every write and for nothing less", () => {
    expect([...EMAIL_WRITE_OPERATIONS].sort()).toEqual(
      ["cancelEmailMessage", "resendEmailMessage", "sendTestEmail"].sort(),
    );
    expect(canManageEmail(["email.manage"])).toBe(true);
    expect(canManageEmail(["shipping.manage", "orders.write", "users.manage"])).toBe(false);
    expect(canManageEmail([])).toBe(false);
    expect(canManageEmail(null)).toBe(false);
  });
});
