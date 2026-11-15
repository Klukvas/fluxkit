import { describe, expect, it, vi } from "vitest";
import {
  createSignInNavigation,
  focusSignInDestination,
  isSignInModalActive,
  isSignInOpenerLink,
  shouldRedirectAccountGuest,
  signInCloseAction,
} from "../lib/sign-in-navigation";

const origin = "/en/catalog?sort=price_asc";

describe("login-link opener filter", () => {
  const loginPath = "/en/account/login";
  const currentHref = `https://shop.test${loginPath}?next=%2Fen%2Fcheckout`;

  it.each([
    "#login-email",
    `${currentHref}#login-email`,
    "/en/account/login?next=%2Fen%2Fcheckout#login-password",
    "#",
  ])("ignores same-document fragment activation %s", (href) => {
    expect(isSignInOpenerLink({ href, currentHref, loginPath, insideDialog: false })).toBe(false);
  });

  it("ignores login links inside a dialog even when they change the query", () => {
    expect(
      isSignInOpenerLink({ href: loginPath, currentHref, loginPath, insideDialog: true }),
    ).toBe(false);
  });

  it.each([loginPath, `${loginPath}?next=%2Fen%2Fcheckout`, `${loginPath}#login-email`])(
    "records real login navigation %s from a different document",
    (href) => {
      expect(
        isSignInOpenerLink({
          href,
          currentHref: `https://shop.test${origin}`,
          loginPath,
          insideDialog: false,
        }),
      ).toBe(true);
    },
  );

  it.each(["https://other.test/en/account/login", "/en/account/register", "/uk/account/login"])(
    "ignores non-login or off-origin links %s",
    (href) => {
      expect(isSignInOpenerLink({ href, currentHref, loginPath, insideDialog: false })).toBe(false);
    },
  );
});

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

describe("post-dialog focus destination", () => {
  function page() {
    const heading = { hasAttribute: () => false, setAttribute: vi.fn(), focus: vi.fn() };
    const main = { hasAttribute: () => true, setAttribute: vi.fn(), focus: vi.fn() };
    return {
      heading,
      main,
      doc: {
        querySelector: (selector: "main h1" | "main") => (selector === "main h1" ? heading : main),
      },
    };
  }

  it.each([origin, "/en/account/forgot-password"])(
    "returns to the connected opener at %s without changing its native Tab order",
    (destination) => {
      const navigation = createSignInNavigation();
      // The header summary and forgot-page anchor need only their native focus method.
      const opener = { isConnected: true, focus: vi.fn() };
      navigation.recordOpener({ origin: destination, opener });
      const { heading, main, doc } = page();
      focusSignInDestination(destination, navigation, doc);
      expect(opener.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
      expect(heading.focus).not.toHaveBeenCalled();
      expect(main.focus).not.toHaveBeenCalled();
      expect(heading.setAttribute).not.toHaveBeenCalled();
    },
  );

  it.each(["/en", "/en/catalog", "/en/catalog?sort=price_desc", "/en/account/register"])(
    "focuses the destination heading instead of an opener from another origin at %s",
    (destination) => {
      const navigation = createSignInNavigation();
      const opener = { isConnected: true, focus: vi.fn() };
      navigation.recordOpener({ origin, opener });
      const { heading, main, doc } = page();
      focusSignInDestination(destination, navigation, doc);
      expect(opener.focus).not.toHaveBeenCalled();
      expect(heading.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
      expect(heading.setAttribute).toHaveBeenCalledExactlyOnceWith("tabindex", "-1");
      expect(main.focus).not.toHaveBeenCalled();
    },
  );

  it("falls back to the heading when the matching opener was removed", () => {
    const navigation = createSignInNavigation();
    const opener = { isConnected: false, focus: vi.fn() };
    navigation.recordOpener({ origin, opener });
    const { heading, doc } = page();
    focusSignInDestination(origin, navigation, doc);
    expect(opener.focus).not.toHaveBeenCalled();
    expect(heading.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  });

  it("focuses the gate destination heading without a recorded login-link opener", () => {
    const { heading, doc } = page();
    focusSignInDestination("/en", createSignInNavigation(), doc);
    expect(heading.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  });

  it("falls back to main while the destination has no heading", () => {
    const { main } = page();
    const doc = {
      querySelector: (selector: "main h1" | "main") => (selector === "main" ? main : null),
    };
    focusSignInDestination("/en", createSignInNavigation(), doc);
    expect(main.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  });
});
