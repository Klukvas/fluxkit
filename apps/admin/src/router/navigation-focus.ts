/**
 * Focus after a client-side navigation (storefront `lib/navigation-focus.ts`, review L9). The shell survives a
 * navigation, so the browser would leave the focus on the clicked link. The focus moves to the new page's `h1` (or `main`
 * while the page has none). Not on the first load, and not when only the query string changed (paging and filter links
 * keep their place). Pure apart from the injected document, so the rules are tested without a browser.
 */

export interface FocusableElement {
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  focus(options?: { preventScroll?: boolean }): void;
}

export interface FocusableDocument {
  querySelector(selector: "main h1" | "main"): FocusableElement | null;
}

export function createNavigationFocus(getDocument: () => FocusableDocument): {
  onPathname(pathname: string): void;
} {
  let previous: string | null = null;
  return {
    onPathname(pathname) {
      const before = previous;
      previous = pathname;
      if (before === null || before === pathname) return;
      const doc = getDocument();
      const target = doc.querySelector("main h1") ?? doc.querySelector("main");
      if (target === null) return;
      // A heading is not focusable by default; -1 makes it focusable by script without adding a tab stop.
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    },
  };
}
