"use client";

import { VisuallyHidden } from "@fluxkit/ui";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SearchIcon } from "./icons";

/** Id of the header's search row: the target of the toggle link (and of `:target` without a script). */
export const SITE_SEARCH_ID = "site-search";

/**
 * The header's search below `lg` (review D-04, mobile batch): the row with the box is hidden behind a search icon, so the
 * header is one row. The icon is an in-page link to the row: without a script the browser follows it, CSS `:target` shows
 * the row (`.fk-header-search` in `app/globals.css`) and the focus moves there. With a script it toggles the row
 * (`aria-expanded`), puts the focus in the box, and Escape in the row closes it and gives the focus back to the icon. From
 * `lg` the icon is hidden and the row is always shown in the header's line, as before.
 */
export function HeaderSearchToggle({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLAnchorElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const pathname = usePathname();
  const shownPath = useRef(pathname);

  // A navigation (a search submitted, a suggestion chosen) closes the row.
  useEffect(() => {
    if (shownPath.current === pathname) return;
    shownPath.current = pathname;
    setOpen(false);
  }, [pathname]);

  // Opening by the icon puts the focus in the box (not on the first render).
  useEffect(() => {
    if (!open) {
      opened.current = false;
      return;
    }
    if (opened.current) return;
    opened.current = true;
    rowRef.current?.querySelector("input")?.focus();
  }, [open]);

  return (
    <>
      <a
        ref={toggleRef}
        href={`#${SITE_SEARCH_ID}`}
        aria-controls={SITE_SEARCH_ID}
        aria-expanded={open}
        className="fk-header-button lg:hidden"
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
      >
        <SearchIcon />
        <VisuallyHidden>{label}</VisuallyHidden>
      </a>
      <div
        ref={rowRef}
        id={SITE_SEARCH_ID}
        className={open ? "fk-header-search fk-open" : "fk-header-search"}
        onKeyDown={(event) => {
          // The box's own Escape closes its suggestions first (it stops the event then); a second one closes the row.
          if (event.key !== "Escape" || !open || event.defaultPrevented) return;
          setOpen(false);
          toggleRef.current?.focus();
        }}
      >
        {children}
      </div>
    </>
  );
}
