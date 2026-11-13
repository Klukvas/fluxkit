"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A header dropdown (the menu, the language and the account): a native `<details>` with its `<summary>` as the button, so it
 * opens and closes without a script (the storefront works before hydration). The script only adds what users expect of a
 * menu button: Escape closes it and gives the focus back to the summary, a click or a focus outside closes it, and it closes
 * after a navigation. The summary's accessible name is `label` (the visible content may be an icon) or its content; the panel holds plain
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
  /**
   * Accessible name of the summary (translated). Left out, the summary is named by its content: for a summary whose visible
   * text changes by breakpoint (the categories picker), so the name always contains the text that is shown.
   */
  label?: string;
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
      <summary role="button" aria-expanded={open} aria-label={label} className="fk-header-button">
        {summary}
      </summary>
      <div
        className={`fk-menu-panel ${align === "end" ? "end-0" : "start-0"}${
          panelClassName === "" ? "" : ` ${panelClassName}`
        }`}
      >
        {children}
      </div>
    </details>
  );
}

/**
 * Class of one entry of a dropdown panel (a link or a button): `.fk-menu-item` in `app/globals.css` (tokens only, through
 * `@apply`), one short class because the header is in every page's first HTML (see the note there).
 */
export const menuItem = "fk-menu-item";

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
