import { ADMIN_OPERATIONS, type AdminUser } from "@fluxkit/api-client";
import { ROLE_PERMISSIONS, decideUserChange } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import {
  USER_ACTIONS,
  USER_ACTION_OPERATIONS,
  activityPatch,
  confirmationOf,
  describeUserRefusal,
  mayConfirm,
  offeredUserActions,
  rolePatch,
  selfConsequence,
  stateAfterUnknown,
} from "./user-actions";

const owner = [...ROLE_PERMISSIONS.owner];
const manager = [...ROLE_PERMISSIONS.manager];
const viewer = [...ROLE_PERMISSIONS.viewer];

function user(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    email: "anna@example.com",
    role: "manager",
    isActive: true,
    lastLoginAt: null,
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-10-01T08:00:00.000Z",
    ...overrides,
  };
}

describe("the actions offered on a user", () => {
  it("names the API operation of every action, and each needs users.manage", () => {
    expect(USER_ACTION_OPERATIONS).toEqual({
      changeRole: "updateUser",
      deactivate: "updateUser",
      activate: "updateUser",
      resetPassword: "resetUserPassword",
    });
    for (const action of USER_ACTIONS) {
      expect(ADMIN_OPERATIONS[USER_ACTION_OPERATIONS[action]].permission).toBe("users.manage");
    }
  });

  it("offers the owner role change, deactivate or activate by the stored activity, and the password reset", () => {
    expect(offeredUserActions(user(), owner)).toEqual([
      "changeRole",
      "deactivate",
      "resetPassword",
    ]);
    expect(offeredUserActions(user({ isActive: false }), owner)).toEqual([
      "changeRole",
      "activate",
      "resetPassword",
    ]);
  });

  it("offers nothing without users.manage: decided by the permission list, never by the role name", () => {
    expect(offeredUserActions(user(), manager)).toEqual([]);
    expect(offeredUserActions(user(), viewer)).toEqual([]);
    expect(offeredUserActions(user(), [])).toEqual([]);
    expect(offeredUserActions(user(), null)).toEqual([]);
    // A session whose list holds users.manage gets the actions, whatever its role is called.
    expect(offeredUserActions(user(), ["users.manage"])).toEqual([
      "changeRole",
      "deactivate",
      "resetPassword",
    ]);
  });
});

describe("the PATCH bodies", () => {
  it("send only what changed: the role alone, or the activity alone", () => {
    expect(rolePatch(user({ role: "manager" }), "viewer")).toEqual({ role: "viewer" });
    expect(activityPatch(user({ isActive: true }), false)).toEqual({ isActive: false });
    expect(activityPatch(user({ isActive: false }), true)).toEqual({ isActive: true });
  });

  it("send nothing when nothing changed (the screen then sends no request)", () => {
    expect(rolePatch(user({ role: "manager" }), "manager")).toEqual({});
    expect(activityPatch(user({ isActive: true }), true)).toEqual({});
  });

  it("never carry the email, the id, dates or anything else of the stored user", () => {
    const keys = Object.keys({ ...rolePatch(user(), "owner"), ...activityPatch(user(), false) });
    expect(keys.sort()).toEqual(["isActive", "role"]);
  });
});

describe("confirmations", () => {
  it("asks before a role change, a deactivation and a password reset; not before activating", () => {
    expect(confirmationOf("changeRole", false)).toEqual({
      ask: true,
      tone: "default",
      selfCheck: false,
    });
    expect(confirmationOf("deactivate", false)).toEqual({
      ask: true,
      tone: "danger",
      selfCheck: false,
    });
    expect(confirmationOf("resetPassword", false)).toEqual({
      ask: true,
      tone: "danger",
      selfCheck: false,
    });
    expect(confirmationOf("activate", false)).toEqual({
      ask: false,
      tone: "default",
      selfCheck: false,
    });
  });

  it("asks the owner for an extra explicit tick when changing their OWN role or activity", () => {
    expect(confirmationOf("changeRole", true).selfCheck).toBe(true);
    expect(confirmationOf("deactivate", true).selfCheck).toBe(true);
    expect(confirmationOf("resetPassword", true).selfCheck).toBe(false);
    expect(mayConfirm(confirmationOf("changeRole", true), false)).toBe(false);
    expect(mayConfirm(confirmationOf("changeRole", true), true)).toBe(true);
    expect(mayConfirm(confirmationOf("changeRole", false), false)).toBe(true);
  });

  it("says what happens to the signed-in owner's own session", () => {
    expect(selfConsequence("changeRole", false, "viewer")).toBe(null);
    expect(selfConsequence("changeRole", true, "manager")).toBe("losesUsersArea");
    expect(selfConsequence("changeRole", true, "owner")).toBe(null);
    expect(selfConsequence("deactivate", true)).toBe("signedOutCannotSignIn");
    expect(selfConsequence("resetPassword", true)).toBe("signedOutSignInAgain");
    expect(selfConsequence("resetPassword", false)).toBe(null);
  });
});

describe("refusals", () => {
  it("explains the last-owner rules in the area's words, matching core's reasons", () => {
    const lastOwner = { id: "o", role: "owner", isActive: true };
    const demote = decideUserChange({
      target: lastOwner,
      change: { role: "manager" },
      activeOwnerIds: ["o"],
    });
    const deactivate = decideUserChange({
      target: lastOwner,
      change: { isActive: false },
      activeOwnerIds: ["o"],
    });
    for (const decision of [demote, deactivate]) {
      expect(decision.allowed).toBe(false);
      if (decision.allowed) continue;
      expect(describeUserRefusal(409, { code: "rule_violation", rule: decision.reason })).toEqual({
        key: `user.refusal.${decision.reason}`,
      });
    }
  });

  it("leaves every other refusal to the shell's problem map (the API's text is never shown)", () => {
    expect(describeUserRefusal(403, { code: "forbidden" })).toEqual({
      key: "errors.code.forbidden",
    });
    expect(describeUserRefusal(404, { code: "not_found" })).toEqual({
      key: "errors.code.not_found",
    });
    expect(describeUserRefusal(409, { code: "rule_violation", rule: "odd" })).toEqual({
      key: "errors.code.rule_violation",
      code: "odd",
    });
  });
});

describe("what the server has after an answer that never arrived", () => {
  it("says what the stored user is, never that the write landed", () => {
    const before = user({ role: "manager", isActive: true });
    expect(stateAfterUnknown("changeRole", "viewer", user({ role: "viewer" }))).toEqual({
      kind: "roleIs",
      role: "viewer",
      changed: true,
    });
    expect(stateAfterUnknown("changeRole", "viewer", before)).toEqual({
      kind: "roleIs",
      role: "manager",
      changed: false,
    });
    expect(stateAfterUnknown("deactivate", undefined, user({ isActive: false }))).toEqual({
      kind: "now_deactivated",
    });
    expect(stateAfterUnknown("deactivate", undefined, before)).toEqual({ kind: "still_active" });
    expect(stateAfterUnknown("activate", undefined, before)).toEqual({ kind: "now_active" });
    expect(stateAfterUnknown("activate", undefined, user({ isActive: false }))).toEqual({
      kind: "still_deactivated",
    });
  });

  it("cannot tell a password reset from the stored user, and says so", () => {
    expect(stateAfterUnknown("resetPassword", undefined, user())).toEqual({
      kind: "password_unknown",
    });
  });

  it("is unreadable without a stored user", () => {
    for (const action of USER_ACTIONS) {
      expect(stateAfterUnknown(action, "viewer", null)).toEqual({ kind: "unreadable" });
    }
  });
});
