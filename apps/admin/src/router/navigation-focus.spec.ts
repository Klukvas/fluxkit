import { describe, expect, it } from "vitest";
import {
  createNavigationFocus,
  type FocusableDocument,
  type FocusableElement,
} from "./navigation-focus";

interface FakeElement extends FocusableElement {
  name: string;
}

/** A document with `main` and, when `withHeading`, an `h1` in it; `activeElement` follows `focus()`. */
function fakeDocument(withHeading: boolean) {
  const focused: string[] = [];
  const attributes: Record<string, string> = {};
  const body = { name: "body" };
  let active: unknown = body;
  const element = (name: string): FakeElement => {
    const self: FakeElement = {
      name,
      hasAttribute: (attribute: string) => `${name}.${attribute}` in attributes,
      setAttribute: (attribute: string, value: string) => {
        attributes[`${name}.${attribute}`] = value;
      },
      focus: () => {
        focused.push(name);
        active = self;
      },
    };
    return self;
  };
  const main = element("main");
  const state = { heading: withHeading ? element("h1") : null };
  const doc: FocusableDocument = {
    querySelector: (selector) => (selector === "main h1" ? state.heading : main),
    get activeElement() {
      return active;
    },
    body,
  };
  return {
    doc,
    focused,
    attributes,
    /** The page's heading mounts now (a lazy page after its chunk or messages). */
    mountHeading: (name = "h1") => {
      state.heading = element(name);
      return state.heading;
    },
    /** The admin moves the focus (a click or a Tab). */
    moveFocusTo: (name: string) => {
      active = element(name);
    },
  };
}

describe("createNavigationFocus", () => {
  it("does nothing on the first load and on a query-only change", () => {
    const { doc, focused } = fakeDocument(true);
    const focus = createNavigationFocus(() => doc);
    focus.onPathname("/orders");
    focus.onPathname("/orders");
    expect(focused).toEqual([]);
  });

  it("moves the focus to the new page's h1 after a path change, focusable by script only", () => {
    const { doc, focused, attributes } = fakeDocument(true);
    const focus = createNavigationFocus(() => doc);
    focus.onPathname("/orders");
    focus.onPathname("/customers");
    expect(focused).toEqual(["h1"]);
    expect(attributes["h1.tabindex"]).toBe("-1");
  });

  it("falls back to main when the page has no heading yet", () => {
    const { doc, focused } = fakeDocument(false);
    const focus = createNavigationFocus(() => doc);
    focus.onPathname("/orders");
    focus.onPathname("/users");
    expect(focused).toEqual(["main"]);
  });

  it("moves the focus from main to the heading once the lazy page's h1 mounts (step 13 review, L3)", () => {
    const { doc, focused, attributes, mountHeading } = fakeDocument(false);
    const focus = createNavigationFocus(() => doc);
    focus.onPathname("/");
    focus.onPathname("/products");
    expect(focused).toEqual(["main"]);
    focus.onHeadingMounted(mountHeading());
    expect(focused).toEqual(["main", "h1"]);
    expect(attributes["h1.tabindex"]).toBe("-1");
    // Only once: a heading that mounts later (a reload of the page, a remount) does not take the focus again.
    focus.onHeadingMounted(mountHeading("h1-again"));
    expect(focused).toEqual(["main", "h1"]);
  });

  it("treats the first page after the sign-in page as a navigation (the router root survives the sign-in)", () => {
    const { doc, focused, mountHeading } = fakeDocument(false);
    const focus = createNavigationFocus(() => doc);
    focus.onPathname("/login");
    focus.onPathname("/orders");
    focus.onHeadingMounted(mountHeading());
    expect(focused).toEqual(["main", "h1"]);
  });

  it("leaves the focus alone when the admin moved it before the heading mounted", () => {
    const { doc, focused, mountHeading, moveFocusTo } = fakeDocument(false);
    const focus = createNavigationFocus(() => doc);
    focus.onPathname("/");
    focus.onPathname("/products");
    moveFocusTo("a:Orders");
    focus.onHeadingMounted(mountHeading());
    expect(focused).toEqual(["main"]);
  });

  it("does not focus a heading that mounts without a navigation (first load, a remount, a query change)", () => {
    const { doc, focused, mountHeading } = fakeDocument(false);
    const focus = createNavigationFocus(() => doc);
    focus.onHeadingMounted(mountHeading());
    focus.onPathname("/orders");
    focus.onHeadingMounted(mountHeading());
    focus.onPathname("/orders");
    focus.onHeadingMounted(mountHeading());
    expect(focused).toEqual([]);
  });

  it("forgets a waiting heading when the next navigation finds its h1 at once", () => {
    const { doc, focused, mountHeading } = fakeDocument(false);
    const focus = createNavigationFocus(() => doc);
    focus.onPathname("/");
    focus.onPathname("/products");
    const heading = mountHeading();
    focus.onPathname("/orders");
    focus.onHeadingMounted(heading);
    expect(focused).toEqual(["main", "h1"]);
  });
});
