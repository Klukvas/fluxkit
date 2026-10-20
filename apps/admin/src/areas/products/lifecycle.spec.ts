import { ROLE_PERMISSIONS, canHardDelete, canTransition } from "@fluxkit/core";
import { ADMIN_OPERATIONS } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import {
  LIFECYCLE_ACTIONS,
  LIFECYCLE_OPERATIONS,
  lifecycleActions,
  permittedActions,
} from "./lifecycle";

const product = (status: "draft" | "active" | "archived", published: boolean) => ({
  status,
  publishedAt: published ? "2026-10-01T00:00:00.000Z" : null,
});

/** Each action is a transition to its target; unpublish and restore both lead to draft, from active and from archived. */
const target = {
  publish: "active",
  unpublish: "draft",
  archive: "archived",
  restore: "draft",
} as const;
const from = {
  publish: ["draft"],
  unpublish: ["active"],
  archive: ["draft", "active"],
  restore: ["archived"],
};

describe("product lifecycle actions", () => {
  it("are the transitions core allows from the status, plus delete for a never-published product", () => {
    for (const status of ["draft", "active", "archived"] as const) {
      for (const published of [false, true]) {
        if (status === "active" && !published) continue;
        const actions = lifecycleActions(product(status, published));
        for (const action of ["publish", "unpublish", "archive", "restore"] as const) {
          expect(actions.includes(action), `${status} ${action}`).toBe(
            from[action].includes(status) && canTransition(status, target[action]),
          );
        }
        expect(actions.includes("delete"), `${status} delete`).toBe(
          canHardDelete({ publishedAt: published ? "x" : null }),
        );
      }
    }
    expect(lifecycleActions(product("draft", false))).toEqual(["publish", "archive", "delete"]);
    expect(lifecycleActions(product("active", true))).toEqual(["unpublish", "archive"]);
    expect(lifecycleActions(product("archived", true))).toEqual(["restore"]);
  });

  it("name the API operation of each action; publish, unpublish, archive and restore need catalog.publish", () => {
    expect(Object.keys(LIFECYCLE_OPERATIONS).sort()).toEqual([...LIFECYCLE_ACTIONS].sort());
    for (const action of ["publish", "unpublish", "archive", "restore"] as const) {
      expect(ADMIN_OPERATIONS[LIFECYCLE_OPERATIONS[action]].permission).toBe("catalog.publish");
    }
    expect(ADMIN_OPERATIONS[LIFECYCLE_OPERATIONS.delete].permission).toBe("catalog.write");
  });

  it("are offered only when the session may run them (never by role name)", () => {
    const draft = product("draft", false);
    expect(permittedActions(draft, [...ROLE_PERMISSIONS.manager])).toEqual([
      "publish",
      "archive",
      "delete",
    ]);
    expect(permittedActions(draft, [...ROLE_PERMISSIONS.viewer])).toEqual([]);
    expect(permittedActions(draft, ["catalog.read", "catalog.write"])).toEqual(["delete"]);
    expect(permittedActions(draft, ["catalog.read", "catalog.publish"])).toEqual([
      "publish",
      "archive",
    ]);
    expect(permittedActions(draft, null)).toEqual([]);
  });
});
