import { PERMISSIONS, ROLES, ROLE_PERMISSIONS } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import {
  USER_ROLES,
  USER_ROLE_PERMISSIONS,
  USER_STATUS_TONES,
  isSelf,
  permissionLabelKey,
  roleLabelKey,
  roleTone,
  statusLabelKey,
  statusTone,
  userHref,
} from "./user-view";

const ID = "44444444-4444-4444-8444-444444444444";

describe("roles as the API knows them", () => {
  it("lists core's roles in core's order", () => {
    expect([...USER_ROLES]).toEqual([...ROLES]);
  });

  it("explains each role by exactly the permissions core gives it (ADR 0009), nothing more", () => {
    for (const role of ROLES) {
      expect([...USER_ROLE_PERMISSIONS[role]], role).toEqual([...ROLE_PERMISSIONS[role]]);
    }
  });

  it("has a label key for every role (the eager account messages) and every permission", () => {
    expect(roleLabelKey("owner")).toBe("role.owner");
    expect(roleLabelKey("viewer")).toBe("role.viewer");
    expect(permissionLabelKey("users.manage")).toBe("user.permission.users.manage");
    for (const permission of PERMISSIONS) {
      expect(permissionLabelKey(permission)).toBe(`user.permission.${permission}`);
    }
  });

  it("marks the owner apart, but the text says the role (the tone is a hint only)", () => {
    expect(roleTone("owner")).not.toBe(roleTone("viewer"));
    expect(roleTone("manager")).toBe(roleTone("viewer"));
  });
});

describe("activity", () => {
  it("says active or deactivated in words, with different tones", () => {
    expect(statusLabelKey(true)).toBe("user.status.active");
    expect(statusLabelKey(false)).toBe("user.status.deactivated");
    expect(statusTone(true)).toBe(USER_STATUS_TONES.active);
    expect(statusTone(false)).toBe(USER_STATUS_TONES.deactivated);
    expect(USER_STATUS_TONES.active).not.toBe(USER_STATUS_TONES.deactivated);
  });
});

describe("links and the signed-in admin", () => {
  it("links a user's detail by id only, as one encoded segment", () => {
    expect(userHref(ID)).toBe(`/users/${ID}`);
    expect(userHref("a/b")).toBe("/users/a%2Fb");
  });

  it("knows the signed-in admin's own row by id, never by email or role", () => {
    expect(isSelf(ID, ID)).toBe(true);
    expect(isSelf(ID, "55555555-5555-4555-8555-555555555555")).toBe(false);
    expect(isSelf(ID, null)).toBe(false);
  });
});
