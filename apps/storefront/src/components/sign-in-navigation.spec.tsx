import { describe, expect, it, vi } from "vitest";
import {
  createSignInNavigation,
  isSignInModalActive,
  shouldRedirectAccountGuest,
  signInCloseAction,
} from "../lib/sign-in-navigation";

const origin = "/en/catalog?sort=price_asc";

describe("sign-in navigation decisions", () => {
  it("recognizes the actual Next 16 modal segments, keeping the gate's original next", () => {
    const active = isSignInModalActive(["(.)account", "login"]);
    expect(active).toBe(true);
    expect(shouldRedirectAccountGuest("guest", active)).toBe(false);
    for (const segments of [null, [], ["__DEFAULT__"], ["catalog"], ["account/login"], ["login"]]) {
      expect(isSignInModalActive(segments)).toBe(false);
    }
  });

  it.each([
    [true, "back"],
    [false, "home"],
    [undefined, "home"],
  ] as const)("closes with %s browser canGoBack as %s", (canGoBack, action) => {
    expect(signInCloseAction(canGoBack)).toBe(action);
  });

  it("restores the latest connected opener only at its exact origin, including search", () => {
    const navigation = createSignInNavigation();
    const opener = { isConnected: true, focus: vi.fn() };
    expect(navigation.openerFor(origin)).toBeNull();
    navigation.recordOpener({ origin, opener });
    expect(navigation.openerFor(origin)).toBe(opener);
    expect(navigation.openerFor("/en/catalog")).toBeNull();
    expect(navigation.openerFor("/en/catalog?sort=price_desc")).toBeNull();
    expect(navigation.openerFor("/en/account")).toBeNull();
    // Back/Forward needs no bookkeeping to retain the same focus destination.
    expect(navigation.openerFor(origin)).toBe(opener);
  });

  it("uses the latest activation instead of keeping history of previous openers", () => {
    const navigation = createSignInNavigation();
    const first = { isConnected: true, focus: vi.fn() };
    const latest = { isConnected: true, focus: vi.fn() };
    navigation.recordOpener({ origin, opener: first });
    navigation.recordOpener({ origin: "/en/account/forgot-password", opener: latest });
    expect(navigation.openerFor(origin)).toBeNull();
    expect(navigation.openerFor("/en/account/forgot-password")).toBe(latest);
  });

  it("does not restore an opener that has left the document", () => {
    const navigation = createSignInNavigation();
    const opener = { isConnected: true, focus: vi.fn() };
    navigation.recordOpener({ origin, opener });
    opener.isConnected = false;
    expect(navigation.openerFor(origin)).toBeNull();
  });

  it("prevents gate re-entry while the modal is active", () => {
    expect(shouldRedirectAccountGuest("guest", false)).toBe(true);
    expect(shouldRedirectAccountGuest("guest", true)).toBe(false);
    for (const status of ["signedIn", "loading", "error"]) {
      expect(shouldRedirectAccountGuest(status, false)).toBe(false);
    }
  });
});
