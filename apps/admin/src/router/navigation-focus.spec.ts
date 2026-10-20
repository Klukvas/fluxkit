import { describe, expect, it } from "vitest";
import { createNavigationFocus, type FocusableDocument } from "./navigation-focus";

function fakeDocument(withHeading: boolean) {
  const focused: string[] = [];
  const attributes: Record<string, string> = {};
  const element = (name: string) => ({
    hasAttribute: (attribute: string) => `${name}.${attribute}` in attributes,
    setAttribute: (attribute: string, value: string) => {
      attributes[`${name}.${attribute}`] = value;
    },
    focus: () => focused.push(name),
  });
  const doc: FocusableDocument = {
    querySelector: (selector) =>
      selector === "main h1" ? (withHeading ? element("h1") : null) : element("main"),
  };
  return { doc, focused, attributes };
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
});
