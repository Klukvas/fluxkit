import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSIONS,
  hasPermission,
  isAdminPermission,
  isAdminRole,
  permissionsOf,
} from "./roles.js";

describe("role table", () => {
  it("lists the fixed roles and permissions", () => {
    expect(ROLES).toEqual(["owner", "manager", "viewer"]);
    expect(PERMISSIONS).toEqual([
      "catalog.read",
      "catalog.write",
      "catalog.publish",
      "users.manage",
      "orders.read",
      "orders.write",
      "customers.read",
      "customers.write",
      "shipping.manage",
      "email.manage",
    ]);
  });

  it("gives each role exactly the permissions of the plan", () => {
    expect([...ROLE_PERMISSIONS.owner]).toEqual([...PERMISSIONS]);
    expect([...ROLE_PERMISSIONS.manager]).toEqual([
      "catalog.read",
      "catalog.write",
      "catalog.publish",
      "orders.read",
      "orders.write",
      "customers.read",
      "customers.write",
      "shipping.manage",
      "email.manage",
    ]);
    expect([...ROLE_PERMISSIONS.viewer]).toEqual(["catalog.read"]);
  });

  it("is frozen so a caller cannot grant itself a permission", () => {
    expect(Object.isFrozen(ROLE_PERMISSIONS)).toBe(true);
    for (const role of ROLES) {
      expect(Object.isFrozen(ROLE_PERMISSIONS[role])).toBe(true);
    }
    expect(Object.isFrozen(ROLES)).toBe(true);
    expect(Object.isFrozen(PERMISSIONS)).toBe(true);
  });
});

describe("isAdminRole / isAdminPermission", () => {
  it("accepts known values only", () => {
    for (const role of ROLES) expect(isAdminRole(role)).toBe(true);
    for (const permission of PERMISSIONS) expect(isAdminPermission(permission)).toBe(true);
  });

  it("rejects unknown, differently cased and non-string values", () => {
    for (const value of [
      "Owner",
      " owner",
      "admin",
      "",
      "__proto__",
      "constructor",
      "toString",
      "hasOwnProperty",
    ]) {
      expect(isAdminRole(value)).toBe(false);
      expect(isAdminPermission(value)).toBe(false);
    }
    for (const value of [undefined, null, 1, {}, [], ["owner"], Symbol("owner")]) {
      expect(isAdminRole(value)).toBe(false);
      expect(isAdminPermission(value)).toBe(false);
    }
  });
});

describe("permissionsOf", () => {
  it("returns a frozen copy, not the table itself", () => {
    const owner = permissionsOf("owner");
    expect(owner).toEqual([...PERMISSIONS]);
    expect(Object.isFrozen(owner)).toBe(true);
    expect(owner).not.toBe(ROLE_PERMISSIONS.owner);
    expect(() => (owner as string[]).push("x")).toThrow();
  });

  it("returns an empty frozen list for unknown roles", () => {
    for (const role of ["__proto__", "constructor", "toString", "admin", ""]) {
      const result = permissionsOf(role);
      expect(result).toEqual([]);
      expect(Object.isFrozen(result)).toBe(true);
    }
  });
});

describe("hasPermission", () => {
  const expected: Record<string, readonly string[]> = {
    owner: [
      "catalog.read",
      "catalog.write",
      "catalog.publish",
      "users.manage",
      "orders.read",
      "orders.write",
      "customers.read",
      "customers.write",
      "shipping.manage",
      "email.manage",
    ],
    manager: [
      "catalog.read",
      "catalog.write",
      "catalog.publish",
      "orders.read",
      "orders.write",
      "customers.read",
      "customers.write",
      "shipping.manage",
      "email.manage",
    ],
    viewer: ["catalog.read"],
  };

  it("matches the matrix for every role and permission", () => {
    for (const role of ROLES) {
      for (const permission of PERMISSIONS) {
        expect(hasPermission(role, permission), `${role} ${permission}`).toBe(
          (expected[role] ?? []).includes(permission),
        );
      }
    }
  });

  it("denies the viewer every write permission", () => {
    expect(hasPermission("viewer", "catalog.write")).toBe(false);
    expect(hasPermission("viewer", "orders.write")).toBe(false);
    expect(hasPermission("viewer", "customers.write")).toBe(false);
    expect(hasPermission("viewer", "catalog.publish")).toBe(false);
    expect(hasPermission("viewer", "users.manage")).toBe(false);
    expect(hasPermission("manager", "users.manage")).toBe(false);
  });

  it("never grants anything to unknown roles, including Object.prototype names", () => {
    for (const role of [
      "__proto__",
      "constructor",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "admin",
      "OWNER",
      "",
    ]) {
      for (const permission of PERMISSIONS) {
        expect(hasPermission(role, permission), `${role} ${permission}`).toBe(false);
      }
    }
    for (const role of [undefined, null, 0, {}, []] as unknown[]) {
      expect(hasPermission(role as string, "catalog.read")).toBe(false);
    }
  });

  it("never grants unknown permissions, even to the owner", () => {
    for (const permission of [
      "",
      "catalog",
      "catalog.delete",
      "__proto__",
      "constructor",
      "length",
      "0",
    ]) {
      expect(hasPermission("owner", permission)).toBe(false);
    }
  });
});

describe("orders and customers permissions (plan 2026-10-17, open question 6)", () => {
  // Typed out by hand: role -> permission -> allowed. Not derived from the table under test.
  const matrix = {
    owner: {
      "catalog.read": true,
      "catalog.write": true,
      "catalog.publish": true,
      "users.manage": true,
      "orders.read": true,
      "orders.write": true,
      "customers.read": true,
      "customers.write": true,
      "shipping.manage": true,
      "email.manage": true,
    },
    manager: {
      "catalog.read": true,
      "catalog.write": true,
      "catalog.publish": true,
      "users.manage": false,
      "orders.read": true,
      "orders.write": true,
      "customers.read": true,
      "customers.write": true,
      "shipping.manage": true,
      "email.manage": true,
    },
    viewer: {
      "catalog.read": true,
      "catalog.write": false,
      "catalog.publish": false,
      "users.manage": false,
      "orders.read": false,
      "orders.write": false,
      "customers.read": false,
      "customers.write": false,
      "shipping.manage": false,
      "email.manage": false,
    },
  } as const;

  const personalData = ["orders.read", "orders.write", "customers.read", "customers.write"];

  it("lists exactly the ten permissions of the matrix", () => {
    expect([...PERMISSIONS].sort()).toEqual(Object.keys(matrix.owner).sort());
  });

  it("matches the whole role x permission matrix", () => {
    for (const role of ROLES) {
      for (const permission of PERMISSIONS) {
        expect(hasPermission(role, permission), `${role} ${permission}`).toBe(
          matrix[role][permission],
        );
      }
    }
  });

  it("gives shipping.manage to the owner and the manager, never to the viewer (ADR 0029 decision 13)", () => {
    expect(hasPermission("owner", "shipping.manage")).toBe(true);
    expect(hasPermission("manager", "shipping.manage")).toBe(true);
    expect(hasPermission("viewer", "shipping.manage")).toBe(false);
  });

  it("gives email.manage to the owner and the manager, never to the viewer (ADR 0031 decision 15)", () => {
    expect(hasPermission("owner", "email.manage")).toBe(true);
    expect(hasPermission("manager", "email.manage")).toBe(true);
    expect(hasPermission("viewer", "email.manage")).toBe(false);
  });

  it("keeps personal data away from the viewer: no order and no customer permission", () => {
    expect(permissionsOf("viewer")).toEqual(["catalog.read"]);
    for (const permission of personalData) {
      expect(hasPermission("viewer", permission), permission).toBe(false);
    }
  });

  it("gives the manager all four and the owner every permission", () => {
    for (const permission of personalData) {
      expect(hasPermission("manager", permission), permission).toBe(true);
      expect(hasPermission("owner", permission), permission).toBe(true);
    }
    expect(permissionsOf("owner")).toHaveLength(10);
    expect(permissionsOf("manager")).toHaveLength(9);
  });

  it("recognizes the new names as permissions and nothing close to them", () => {
    for (const permission of personalData) {
      expect(isAdminPermission(permission), permission).toBe(true);
    }
    for (const value of [
      "orders",
      "orders.delete",
      "order.read",
      "customer.read",
      "orders.manage",
      "Orders.read",
    ]) {
      expect(isAdminPermission(value), value).toBe(false);
      expect(hasPermission("owner", value), value).toBe(false);
    }
  });
});
