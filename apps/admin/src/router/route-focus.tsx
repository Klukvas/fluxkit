import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { createNavigationFocus, type NavigationFocus } from "./navigation-focus";

const RouteFocusContext = createContext<NavigationFocus | null>(null);

/**
 * Focus and scroll position after a navigation, for every route (the sign-in page included): it sits at the router's
 * root, so the shell's first render after a sign-in is a navigation too (step 13 review, L3). Rules in
 * `navigation-focus.ts`.
 */
export function RouteFocus({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [focus] = useState(() => createNavigationFocus(() => document));
  const previous = useRef<string | null>(null);
  useEffect(() => {
    // The SPA uses no `ScrollRestoration` (it would need an inline script); a new page starts at the top.
    if (previous.current !== null && previous.current !== pathname) window.scrollTo(0, 0);
    previous.current = pathname;
    focus.onPathname(pathname);
  }, [focus, pathname]);
  return <RouteFocusContext.Provider value={focus}>{children}</RouteFocusContext.Provider>;
}

/** For the page heading: tells the route focus that the page's `h1` is there (`null` outside the router, in tests). */
export function useRouteFocus(): NavigationFocus | null {
  return useContext(RouteFocusContext);
}
