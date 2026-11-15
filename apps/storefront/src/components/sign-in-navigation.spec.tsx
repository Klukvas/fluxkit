import { describe, expect, it, vi } from "vitest";
import { createSignInNavigation, shouldRedirectAccountGuest } from "../lib/sign-in-navigation";

const destination = "/en/account/login";
const origin = "/en/catalog";

describe("sign-in navigation decisions", () => {
  it("dismisses a known push with Back exactly once and restores its origin opener", () => {
    const navigation = createSignInNavigation();
    const opener = { isConnected: true, focus: vi.fn() };
    navigation.route(false, origin);
    navigation.prepare({ kind: "push", destination, origin, opener });
    expect(navigation.route(true, destination).skipFocus).toBe(true);
    expect(navigation.dismiss()).toBe("back");
    expect(navigation.dismiss()).toBeNull();
    expect(navigation.route(false, origin)).toEqual({
      skipFocus: true,
      restoreFocus: true,
      opener,
    });
    navigation.traversal();
    navigation.route(true, destination);
    expect(navigation.dismiss()).toBe("back");
  });

  it.each(["replace", "unknown"] as const)("dismisses %s to home", (kind) => {
    const navigation = createSignInNavigation();
    if (kind === "replace") navigation.prepare({ kind, destination, origin, opener: null });
    navigation.route(true, destination);
    expect(navigation.dismiss()).toBe("home");
    expect(navigation.dismiss()).toBeNull();
  });

  it("does not reuse push metadata for a later unknown navigation or restore focus on success", () => {
    const navigation = createSignInNavigation();
    navigation.prepare({ kind: "push", destination, origin, opener: null });
    navigation.route(true, destination);
    expect(navigation.route(false, "/en/account").skipFocus).toBe(false);
    navigation.route(true, destination);
    expect(navigation.dismiss()).toBe("home");
  });

  it("prevents gate re-entry while the modal is active", () => {
    expect(shouldRedirectAccountGuest("guest", false)).toBe(true);
    expect(shouldRedirectAccountGuest("guest", true)).toBe(false);
    for (const status of ["signedIn", "loading", "error"]) {
      expect(shouldRedirectAccountGuest(status, false)).toBe(false);
    }
  });
});
