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
    ]);
  });

  it("gives each role exactly the permissions of the plan", () => {
    expect([...ROLE_PERMISSIONS.owner]).toEqual([...PERMISSIONS]);
    expect([...ROLE_PERMISSIONS.manager]).toEqual([
      "catalog.read",
      "catalog.write",
      "catalog.publish",
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
    owner: ["catalog.read", "catalog.write", "catalog.publish", "users.manage"],
    manager: ["catalog.read", "catalog.write", "catalog.publish"],
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
