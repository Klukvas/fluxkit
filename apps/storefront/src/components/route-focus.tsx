"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { createNavigationFocus } from "../lib/navigation-focus";

/** Renders nothing: after a client-side navigation it moves the focus to the new page's heading (`lib/navigation-focus.ts`). */
export function RouteFocus() {
  const pathname = usePathname();
  const focus = useRef(createNavigationFocus(() => document));
  useEffect(() => {
    focus.current.onPathname(pathname);
  }, [pathname]);
  return null;
}
