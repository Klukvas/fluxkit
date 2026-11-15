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
    // Slot and pathname updates can arrive separately. Wait for the destination commit.
    if (closed && pathname.endsWith("/account/login")) return;
    wasModalActive.current = active;
    const signedIn = !active && (navigation?.coordinator.takePostSignInHeading() ?? false);
    focus.current.onPathname(pathname, active || closed || signedIn);
    if (signedIn) focusPageHeading(document);
  }, [pathname, navigation?.active, navigation?.coordinator]);
  return null;
}
