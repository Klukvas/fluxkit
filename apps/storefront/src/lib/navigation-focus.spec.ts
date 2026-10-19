import { describe, expect, it } from "vitest";
import { createNavigationFocus, type FocusableDocument } from "./navigation-focus";

interface FakeElement {
  name: string;
  attributes: Map<string, string>;
  focused: { preventScroll: boolean | undefined }[];
  setAttribute(name: string, value: string): void;
  hasAttribute(name: string): boolean;
  focus(options?: { preventScroll?: boolean }): void;
}

function element(name: string, attributes: Record<string, string> = {}): FakeElement {
  const map = new Map(Object.entries(attributes));
  const focused: FakeElement["focused"] = [];
  return {
    name,
    attributes: map,
    focused,
    setAttribute: (key, value) => void map.set(key, value),
    hasAttribute: (key) => map.has(key),
    focus: (options) => void focused.push({ preventScroll: options?.preventScroll }),
  };
}

function page(parts: { heading?: FakeElement; main?: FakeElement }): FocusableDocument {
  return {
    querySelector: (selector) => {
      if (selector === "main h1") return parts.heading ?? null;
      if (selector === "main") return parts.main ?? null;
      throw new Error(`unexpected selector ${selector}`);
    },
  };
}

describe("createNavigationFocus", () => {
  it("does nothing for the first page (the browser's own load, the skip link and the document are already right)", () => {
    const heading = element("h1");
    const focus = createNavigationFocus(() => page({ heading }));
    focus.onPathname("/uk");
    expect(heading.focused).toEqual([]);
  });

  it("moves the focus to the page's h1 after a navigation to another path, without scrolling", () => {
    const heading = element("h1");
    const focus = createNavigationFocus(() => page({ heading }));
    focus.onPathname("/uk");
    focus.onPathname("/uk/catalog");
    expect(heading.focused).toEqual([{ preventScroll: true }]);
    // A heading is not focusable by default: it gets tabindex -1 (focusable by script, not a tab stop).
    expect(heading.attributes.get("tabindex")).toBe("-1");
  });

  it("keeps an existing tabindex of the heading", () => {
    const heading = element("h1", { tabindex: "0" });
    const focus = createNavigationFocus(() => page({ heading }));
    focus.onPathname("/a");
    focus.onPathname("/b");
    expect(heading.attributes.get("tabindex")).toBe("0");
  });

  it("falls back to main while the new page has no heading yet (a loading state)", () => {
    const main = element("main", { tabindex: "-1" });
    const focus = createNavigationFocus(() => page({ main }));
    focus.onPathname("/a");
    focus.onPathname("/b");
    expect(main.focused).toEqual([{ preventScroll: true }]);
  });

  it("does nothing when the path did not change (a re-render, a strict-mode effect, a query-only change)", () => {
    const heading = element("h1");
    const focus = createNavigationFocus(() => page({ heading }));
    focus.onPathname("/a");
    focus.onPathname("/a");
    focus.onPathname("/a");
    expect(heading.focused).toEqual([]);
  });

  it("does nothing, and does not throw, when the page has neither a heading nor main", () => {
    const focus = createNavigationFocus(() => page({}));
    focus.onPathname("/a");
    expect(() => focus.onPathname("/b")).not.toThrow();
  });

  it("moves the focus again for every later navigation", () => {
    const heading = element("h1");
    const focus = createNavigationFocus(() => page({ heading }));
    for (const path of ["/a", "/b", "/c", "/a"]) focus.onPathname(path);
    expect(heading.focused).toHaveLength(3);
  });
});
