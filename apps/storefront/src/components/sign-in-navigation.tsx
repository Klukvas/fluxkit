"use client";

import type { Locale } from "@fluxkit/ui";
import { useSelectedLayoutSegments } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { localizedHref } from "../lib/locale-path";
import { createSignInNavigation, isSignInModalActive } from "../lib/sign-in-navigation";

interface Navigation {
  active: boolean;
  coordinator: ReturnType<typeof createSignInNavigation>;
}
const SignInContext = createContext<Navigation | null>(null);

export function useSignInNavigation() {
  return useContext(SignInContext);
}

/** Observes normal anchors without changing their URL, click semantics or Next history state. */
export function SignInNavigation({ locale, children }: { locale: Locale; children: ReactNode }) {
  const segments = useSelectedLayoutSegments("modal");
  const [coordinator] = useState(createSignInNavigation);
  const active = isSignInModalActive(segments);
  useEffect(() => {
    const observe = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.download ||
        (anchor.target && anchor.target !== "_self")
      )
        return;
      const url = new URL(anchor.href);
      if (
        url.origin !== window.location.origin ||
        url.pathname !== localizedHref(locale, "/account/login")
      )
        return;
      const opener = anchor.closest("header")
        ? (anchor.closest("details")?.querySelector("summary") ?? anchor)
        : anchor;
      coordinator.recordOpener({
        origin: window.location.pathname + window.location.search,
        opener,
      });
    };
    document.addEventListener("click", observe, true);
    return () => document.removeEventListener("click", observe, true);
  }, [coordinator, locale]);
  return (
    <SignInContext.Provider value={{ active, coordinator }}>{children}</SignInContext.Provider>
  );
}
