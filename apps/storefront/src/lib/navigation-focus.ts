/**
 * Focus after a client-side navigation (review L9). The shell survives a navigation, so the browser leaves the focus on the
 * link that was clicked (now in the old page's place), and a keyboard or screen reader user continues from the header. The
 * route announcer says the new title, but the focus is the reading position: it moves to the new page's `h1`, or to `main`
 * while the page is still a loading state. Not on the first load (nothing was navigated), and not when only the query
 * string changed (the path is the same; the paging links keep their own place).
 *
 * Pure apart from the injected document, so the rules are tested without a browser.
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
