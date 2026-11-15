"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useSignInNavigation } from "./sign-in-navigation";
import { createNavigationFocus } from "../lib/navigation-focus";

/** Renders nothing: after a client-side navigation it moves the focus to the new page's heading (`lib/navigation-focus.ts`). */
export function RouteFocus() {
  const navigation = useSignInNavigation();
  const pathname = usePathname();
  const focus = useRef(createNavigationFocus(() => document));
  useEffect(() => {
    const transition = navigation?.coordinator.route(
      navigation.active,
      window.location.pathname + window.location.search,
    );
    focus.current.onPathname(pathname, transition?.skipFocus);
    if (!transition?.restoreFocus) return;
    // The next frame is after dialog teardown, regardless of sibling effect order.
    const frame = requestAnimationFrame(() => {
      const target = transition.opener?.isConnected
        ? transition.opener
        : (document.querySelector<HTMLElement>("main h1") ??
          document.querySelector<HTMLElement>("main"));
      if (target instanceof HTMLElement && !target.hasAttribute("tabindex")) target.tabIndex = -1;
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname, navigation?.active, navigation?.coordinator]);
  return null;
}
