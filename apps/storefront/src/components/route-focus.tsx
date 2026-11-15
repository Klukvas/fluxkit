"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useSignInNavigation } from "./sign-in-navigation";
import { createNavigationFocus, focusPageHeading } from "../lib/navigation-focus";

/** Renders nothing: after a client-side navigation it moves the focus to the new page's heading (`lib/navigation-focus.ts`). */
export function RouteFocus() {
  const navigation = useSignInNavigation();
  const pathname = usePathname();
  const focus = useRef(createNavigationFocus(() => document));
  const wasModalActive = useRef(false);
  useEffect(() => {
    const active = navigation?.active ?? false;
    const closed = wasModalActive.current && !active;
    wasModalActive.current = active;
    focus.current.onPathname(pathname, active || closed);
    if (!closed) return;
    // Native close() restores pre-dialog focus during teardown. Both return paths must run after it.
    const frame = requestAnimationFrame(() => {
      const opener = navigation?.coordinator.openerFor(
        window.location.pathname + window.location.search,
      );
      if (opener) opener.focus({ preventScroll: true });
      else focusPageHeading(document);
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname, navigation?.active, navigation?.coordinator]);
  return null;
}
