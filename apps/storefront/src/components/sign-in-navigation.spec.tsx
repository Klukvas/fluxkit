import { describe, expect, it, vi } from "vitest";
import {
  createSignInNavigation,
  isSignInModalActive,
  shouldRedirectAccountGuest,
} from "../lib/sign-in-navigation";

const destination = "/en/account/login";
const origin = "/en/catalog";

describe("sign-in navigation decisions", () => {
  it("recognizes the actual Next 16 modal segments, keeping the gate's original next", () => {
    const active = isSignInModalActive(["(.)account", "login"]);
    expect(active).toBe(true);
    expect(shouldRedirectAccountGuest("guest", active)).toBe(false);
    for (const segments of [null, [], ["__DEFAULT__"], ["catalog"], ["account/login"], ["login"]]) {
      expect(isSignInModalActive(segments)).toBe(false);
    }
  });

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

  it("closes to home after gate → Register → Sign in → Back twice", () => {
    const navigation = createSignInNavigation();
    const register = "/en/account/register?next=%2Fen%2Faccount%2Forders%3Fpage%3D3";
    const login = "/en/account/login?next=%2Fen%2Faccount%2Forders%3Fpage%3D3";
    navigation.prepare({
      kind: "replace",
      destination: login,
      origin: "/en/account/orders?page=3",
      opener: null,
    });
    navigation.route(true, login);
    navigation.route(false, register);
    navigation.prepare({ kind: "push", destination: login, origin: register, opener: null });
    navigation.route(true, login);
    expect(navigation.dismiss()).toBe("back");
    navigation.traversal();
    navigation.route(false, register);
    navigation.traversal();
    navigation.route(true, login);
    expect(navigation.dismiss()).toBe("home");
  });

  it("does not identify an unknown entry by another push with the same URL", () => {
    const navigation = createSignInNavigation();
    navigation.route(true, destination);
    navigation.route(false, origin);
    navigation.prepare({ kind: "push", destination, origin, opener: null });
    navigation.route(true, destination);
    navigation.traversal();
    navigation.route(false, origin);
    navigation.traversal();
    navigation.route(true, destination);
    expect(navigation.dismiss()).toBe("home");
  });

  it("does not regain false certainty after its bounded traversal history fills up", () => {
    const navigation = createSignInNavigation();
    for (let index = 0; index < 21; index += 1) {
      navigation.prepare({ kind: "push", destination, origin, opener: null });
      navigation.route(true, destination);
      expect(navigation.dismiss()).toBe("back");
      navigation.route(false, origin);
    }
    navigation.traversal();
    navigation.route(true, destination);
    expect(navigation.dismiss()).toBe("home");
  });
});
