import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { mayOpenRoute } from "./route-gate";

/** The permission gate of the shell (privacy UI review F5): a route the role may not open shows "not allowed". */
describe("mayOpenRoute", () => {
  it("lets a route through only when the session has the route's permission", () => {
    const can = vi.fn((permission: string) => permission === "privacy.manage");
    expect(mayOpenRoute({ permission: "privacy.manage" }, can)).toBe(true);
    expect(mayOpenRoute({ permission: "orders.write" }, can)).toBe(false);
    expect(can.mock.calls.map((call) => call[0])).toEqual(["privacy.manage", "orders.write"]);
  });

  it("refuses every route for a session that has no permission at all", () => {
    expect(mayOpenRoute({ permission: "privacy.manage" }, () => false)).toBe(false);
    expect(mayOpenRoute({ permission: "orders.write" }, () => false)).toBe(false);
  });

  it("lets a path without a route handle through, to the not-found page", () => {
    const can = vi.fn(() => false);
    expect(mayOpenRoute(undefined, can)).toBe(true);
    expect(can).not.toHaveBeenCalled();
  });
});

describe("the shell", () => {
  const shell = readFileSync(join(import.meta.dirname, "shell.tsx"), "utf8");

  it("decides with the gate, and renders the page only when it is open", () => {
    expect(shell).toMatch(
      /const allowed = mayOpenRoute\(handle, \(permission\) => session\.can\(permission\)\);/,
    );
    expect(shell).toMatch(/\{allowed \? <Outlet \/> : <NotAllowedView t=\{t\} \/>\}/);
  });
});
