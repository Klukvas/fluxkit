"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { focusRing } from "./styles";

/**
 * A header dropdown (the menu, the language and the account): a native `<details>` with its `<summary>` as the button, so it
 * opens and closes without a script (the storefront works before hydration). The script only adds what users expect of a
 * menu button: Escape closes it and gives the focus back to the summary, a click or a focus outside closes it, and it closes
 * after a navigation. The summary's accessible name is `label` (the visible content may be an icon); the panel holds plain
 * links and buttons in DOM order, so Tab walks through them.
 */
export function HeaderDisclosure({
  label,
  summary,
  align = "end",
  panelClassName = "",
  className = "",
  children,
}: {
  /** Accessible name of the summary (translated). */
  label: string;
  /** What the summary shows: an icon, a flag, a short text. */
  summary: ReactNode;
  /** The side of the summary the panel is aligned with. */
  align?: "start" | "end";
  panelClassName?: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  // Mirrors the native open state for `aria-expanded`: a `summary` without an explicit role is not exposed as a button with
  // a name by every engine (Playwright's role tree shows it nameless), so it gets `role="button"` and the state.
  const [open, setOpen] = useState(false);
  useDismiss(ref);
  // A menu opened before hydration: show its real state.
  useEffect(() => {
    if (ref.current?.open === true) setOpen(true);
  }, []);
  return (
    <details
      ref={ref}
      className={`group relative ${className}`}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        role="button"
        aria-expanded={open}
        aria-label={label}
        className={`inline-flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center gap-1 rounded-md px-2 text-foreground hover:bg-muted [&::-webkit-details-marker]:hidden ${focusRing}`}
      >
        {summary}
      </summary>
      <div
        className={`absolute top-full z-30 mt-1 w-max min-w-48 rounded-md border border-border bg-background p-1 shadow-card ${
          align === "end" ? "end-0" : "start-0"
        } ${panelClassName}`}
      >
        {children}
      </div>
    </details>
  );
}

/** Classes of one entry of a dropdown panel (a link or a button), tokens only. */
export const menuItem = `flex min-h-11 w-full items-center gap-2 whitespace-nowrap rounded-md px-3 text-start text-foreground hover:bg-muted ${focusRing}`;

/** Closes an open `<details>` on Escape (focus back to its summary), on a pointer or focus outside, and after a navigation. */
export function useDismiss(ref: { current: HTMLDetailsElement | null }): void {
  const pathname = usePathname();
  // Only a CHANGE of path closes it: on the first run (hydration) a menu the shopper opened before the script ran stays
  // open (found by the e2e language-switch scenario).
  const shownPath = useRef(pathname);
  useEffect(() => {
    if (shownPath.current === pathname) return;
    shownPath.current = pathname;
    const details = ref.current;
    if (details !== null) details.open = false;
  }, [ref, pathname]);

  useEffect(() => {
    const details = ref.current;
    if (details === null) return;
    const close = (focusSummary: boolean) => {
      if (!details.open) return;
      details.open = false;
      if (focusSummary) details.querySelector("summary")?.focus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && details.open) {
        event.preventDefault();
        close(true);
      }
    };
    const onOutside = (event: Event) => {
      if (event.target instanceof Node && !details.contains(event.target)) close(false);
    };
    details.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("focusin", onOutside);
    return () => {
      details.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("focusin", onOutside);
    };
  }, [ref]);
}
