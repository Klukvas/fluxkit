import { describe, expect, it } from "vitest";
import { deepFreeze } from "../catalog/test-support.js";
import { decideUserChange } from "./user-rules.js";

const owner = (id: string, isActive = true) => ({ id, role: "owner", isActive });

describe("decideUserChange", () => {
  it("blocks demoting the last active owner", () => {
    for (const role of ["manager", "viewer"]) {
      expect(
        decideUserChange({ target: owner("a"), change: { role }, activeOwnerIds: ["a"] }),
      ).toEqual({
        allowed: false,
        reason: "last_owner_cannot_be_demoted",
      });
    }
  });

  it("blocks deactivating the last active owner", () => {
    expect(
      decideUserChange({ target: owner("a"), change: { isActive: false }, activeOwnerIds: ["a"] }),
    ).toEqual({
      allowed: false,
      reason: "last_owner_cannot_be_deactivated",
    });
  });

  it("reports demotion first when a change demotes and deactivates the last owner", () => {
    expect(
      decideUserChange({
        target: owner("a"),
        change: { role: "viewer", isActive: false },
        activeOwnerIds: ["a"],
      }),
    ).toEqual({ allowed: false, reason: "last_owner_cannot_be_demoted" });
  });

  it("blocks when activeOwnerIds does not list the target (stale or empty list)", () => {
    expect(
      decideUserChange({ target: owner("a"), change: { role: "viewer" }, activeOwnerIds: [] }),
    ).toEqual({
      allowed: false,
      reason: "last_owner_cannot_be_demoted",
    });
  });

  it("allows demoting or deactivating an owner when another active owner remains", () => {
    expect(
      decideUserChange({
        target: owner("a"),
        change: { role: "manager" },
        activeOwnerIds: ["a", "b"],
      }),
    ).toEqual({
      allowed: true,
    });
    expect(
      decideUserChange({
        target: owner("a"),
        change: { isActive: false },
        activeOwnerIds: ["b", "a"],
      }),
    ).toEqual({
      allowed: true,
    });
    expect(
      decideUserChange({
        target: owner("a"),
        change: { role: "viewer", isActive: false },
        activeOwnerIds: ["a", "b"],
      }),
    ).toEqual({ allowed: true });
  });

  it("does not count the target itself as the remaining owner", () => {
    expect(
      decideUserChange({
        target: owner("a"),
        change: { role: "viewer" },
        activeOwnerIds: ["a", "a"],
      }),
    ).toEqual({
      allowed: false,
      reason: "last_owner_cannot_be_demoted",
    });
  });

  it("allows a no-op change on the last owner", () => {
    expect(decideUserChange({ target: owner("a"), change: {}, activeOwnerIds: ["a"] })).toEqual({
      allowed: true,
    });
    expect(
      decideUserChange({ target: owner("a"), change: { role: "owner" }, activeOwnerIds: ["a"] }),
    ).toEqual({
      allowed: true,
    });
    expect(
      decideUserChange({ target: owner("a"), change: { isActive: true }, activeOwnerIds: ["a"] }),
    ).toEqual({
      allowed: true,
    });
  });

  it("allows changing non-owners freely", () => {
    const manager = { id: "m", role: "manager", isActive: true };
    expect(
      decideUserChange({ target: manager, change: { role: "viewer" }, activeOwnerIds: ["a"] }),
    ).toEqual({
      allowed: true,
    });
    expect(
      decideUserChange({ target: manager, change: { isActive: false }, activeOwnerIds: ["a"] }),
    ).toEqual({
      allowed: true,
    });
    expect(
      decideUserChange({ target: manager, change: { role: "owner" }, activeOwnerIds: ["a"] }),
    ).toEqual({
      allowed: true,
    });
  });

  it("allows changing an already inactive owner", () => {
    expect(
      decideUserChange({
        target: owner("x", false),
        change: { role: "viewer" },
        activeOwnerIds: ["a"],
      }),
    ).toEqual({
      allowed: true,
    });
    expect(
      decideUserChange({
        target: owner("x", false),
        change: { role: "viewer" },
        activeOwnerIds: [],
      }),
    ).toEqual({
      allowed: true,
    });
  });

  it("allows reactivating an inactive user", () => {
    const user = { id: "x", role: "viewer", isActive: false };
    expect(
      decideUserChange({ target: user, change: { isActive: true }, activeOwnerIds: ["a"] }),
    ).toEqual({
      allowed: true,
    });
  });

  it("rejects unknown role strings, including Object.prototype names", () => {
    for (const role of ["admin", "Owner", "", "__proto__", "constructor", "toString"]) {
      expect(
        decideUserChange({ target: owner("a"), change: { role }, activeOwnerIds: ["a", "b"] }),
      ).toEqual({
        allowed: false,
        reason: "unknown_role",
      });
      expect(
        decideUserChange({
          target: { id: "m", role: "viewer", isActive: true },
          change: { role },
          activeOwnerIds: ["a"],
        }),
      ).toEqual({ allowed: false, reason: "unknown_role" });
    }
    expect(
      decideUserChange({
        target: owner("a"),
        change: { role: 1 as unknown as string },
        activeOwnerIds: ["a", "b"],
      }),
    ).toEqual({ allowed: false, reason: "unknown_role" });
  });

  it("does not mutate frozen inputs and gives equal results on two calls", () => {
    const input = deepFreeze({
      target: owner("a"),
      change: { role: "viewer" },
      activeOwnerIds: ["a"],
    });
    expect(decideUserChange(input)).toEqual(decideUserChange(input));
  });
});
