import { describe, expect, it } from "vitest";
import { createUnsavedChangesRegistry, leaveOrAsk, shouldBlockNavigation } from "./unsaved-changes";

const at = (pathname: string, search = "", hash = "") => ({ pathname, search, hash });

describe("shouldBlockNavigation", () => {
  it("never blocks a clean form", () => {
    expect(shouldBlockNavigation(false, at("/account"), at("/orders"))).toBe(false);
  });

  it("blocks leaving a dirty form for another path or another query", () => {
    expect(shouldBlockNavigation(true, at("/account"), at("/orders"))).toBe(true);
    expect(shouldBlockNavigation(true, at("/products/1"), at("/products/1", "?tab=prices"))).toBe(
      true,
    );
  });

  it("does not block a jump inside the page (the skip link's fragment)", () => {
    expect(shouldBlockNavigation(true, at("/account"), at("/account", "", "#main"))).toBe(false);
  });
});

describe("the unsaved-changes registry and leaveOrAsk (sign-out asks first, step 13 review L4)", () => {
  function attempt(registry: ReturnType<typeof createUnsavedChangesRegistry> | null) {
    const log: string[] = [];
    const asked: { leave?: () => void } = {};
    leaveOrAsk(
      registry,
      () => log.push("left"),
      (leave) => {
        log.push("asked");
        asked.leave = leave;
      },
    );
    return { log, confirm: () => asked.leave?.() };
  }

  it("leaves at once when no guard reports unsaved input (and outside the shell)", () => {
    expect(attempt(createUnsavedChangesRegistry()).log).toEqual(["left"]);
    expect(attempt(null).log).toEqual(["left"]);
  });

  it("asks while any guard is dirty, and leaves only when the question is confirmed", () => {
    const registry = createUnsavedChangesRegistry();
    registry.report("a", true);
    registry.report("b", false);
    const run = attempt(registry);
    expect(run.log).toEqual(["asked"]);
    run.confirm();
    expect(run.log).toEqual(["asked", "left"]);
  });

  it("forgets a guard that became clean or unmounted (reported false)", () => {
    const registry = createUnsavedChangesRegistry();
    registry.report("a", true);
    registry.report("b", true);
    registry.report("a", false);
    expect(registry.hasUnsavedChanges()).toBe(true);
    registry.report("b", false);
    expect(registry.hasUnsavedChanges()).toBe(false);
    expect(attempt(registry).log).toEqual(["left"]);
  });
});
