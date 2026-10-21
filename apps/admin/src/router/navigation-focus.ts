/**
 * Focus after a client-side navigation (storefront `lib/navigation-focus.ts`, review L9). The router root survives a
 * navigation, so the browser would leave the focus on the clicked link. The focus moves to the new page's `h1`. Not on
 * the first load, and not when only the query string changed (paging and filter links keep their place). A lazy page
 * often renders its `h1` after the path changed (its chunk or its message files are still loading): then `main` takes
 * the focus meanwhile and the heading takes it as soon as it mounts (`onHeadingMounted`), unless the admin has moved
 * the focus elsewhere in between (step 13 review, L3). Pure apart from the injected document, so the rules are tested
 * without a browser.
 */

export interface FocusableElement {
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  focus(options?: { preventScroll?: boolean }): void;
}

export interface FocusableDocument {
  querySelector(selector: "main h1" | "main"): FocusableElement | null;
  /** Compared by identity only: is the focus still where this module put it? */
  readonly activeElement: unknown;
  readonly body: unknown;
}

export interface NavigationFocus {
  /** Called with every location; a new path (not the first one) is a navigation. */
  onPathname(pathname: string): void;
  /** Called by the page heading (`PageHeading`) when it mounts. */
  onHeadingMounted(heading: FocusableElement): void;
}

function focusByScript(target: FocusableElement): void {
  // A heading is not focusable by default; -1 makes it focusable by script without adding a tab stop.
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
}

export function createNavigationFocus(getDocument: () => FocusableDocument): NavigationFocus {
  let previous: string | null = null;
  /** `main` while it holds the focus for a heading that has not mounted yet. */
  let waitingIn: FocusableElement | null = null;
  return {
    onPathname(pathname) {
      const before = previous;
      previous = pathname;
      if (before === null || before === pathname) return;
      waitingIn = null;
      const doc = getDocument();
      const heading = doc.querySelector("main h1");
      if (heading !== null) {
        focusByScript(heading);
        return;
      }
      const main = doc.querySelector("main");
      if (main === null) return;
      focusByScript(main);
      waitingIn = main;
    },
    onHeadingMounted(heading) {
      const main = waitingIn;
      if (main === null) return;
      waitingIn = null;
      const doc = getDocument();
      const active = doc.activeElement;
      // The admin moved on (a click, a Tab) while the page loaded: leave the focus where they put it.
      if (active !== main && active !== doc.body && active !== null) return;
      focusByScript(heading);
    },
  };
}
