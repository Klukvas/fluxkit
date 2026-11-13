"use client";

import type { ThemeMode } from "@fluxkit/theme";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState, type MouseEvent } from "react";
import { parseThemeMode, storefrontThemeModes, themeCookie } from "../lib/theme-mode";

export interface ThemeSwitchLabels {
  /** Name of the group ("Theme"). */
  group: string;
  light: string;
  dark: string;
  system: string;
}

/**
 * The look of the switch: `buttons`, a row of three bordered buttons beside the label (the footer's `themeSwitch` block);
 * `menu`, the label and three full-width rows (the panel of the header's `theme` control and its copy in the phone menu).
 * One class per element either way: the switch is part of every page's first HTML.
 */
export type ThemeSwitchVariant = "buttons" | "menu";

const CLASSES = {
  buttons: { form: "fk-theme-form", group: "fk-theme-group", option: "fk-theme-option" },
  menu: { form: "fk-theme-menu", group: "fk-theme-menu-group", option: "fk-theme-item" },
} as const;

/**
 * Tells the other switches of the page (the header's control and its copy in the phone menu) that the theme changed, so
 * their `aria-pressed` states stay right. Not shared with anything outside this file.
 */
const THEME_CHANGE_EVENT = "fluxkit:theme-change";

/**
 * The Light / Dark / System switch (plan 2026-11-03-storefront-design-b.md, decision 5): three buttons with `aria-pressed`
 * in a labelled group. Without a script it is a plain form: the browser posts the choice to `/theme` (`app/theme/route.ts`),
 * which stores it and sends the shopper back to this path. With a script the choice applies in place: the cookie is written
 * here (one of the two places in the storefront that write a cookie, guarded by a spec) and `<html data-theme>` changes at
 * once, so the next page the server renders matches. Text buttons and one class each: the switch is part of every page's
 * first HTML (a loose size cap since ADR 0048, `shell.spec.tsx`).
 */
export function ThemeSwitch({
  initialMode,
  labels,
  variant = "buttons",
}: {
  /** The mode the server rendered `<html data-theme>` with. */
  initialMode: ThemeMode;
  labels: ThemeSwitchLabels;
  variant?: ThemeSwitchVariant;
}) {
  const [mode, setMode] = useState(initialMode);
  const pathname = usePathname();
  const labelId = useId();
  const classes = CLASSES[variant];

  useEffect(() => {
    const follow = (event: Event) => {
      const next = event instanceof CustomEvent ? parseThemeMode(String(event.detail)) : null;
      if (next !== null) setMode(next);
    };
    window.addEventListener(THEME_CHANGE_EVENT, follow);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, follow);
  }, []);

  function choose(event: MouseEvent<HTMLButtonElement>, next: ThemeMode) {
    event.preventDefault();
    document.cookie = themeCookie(next, { secure: window.location.protocol === "https:" });
    document.documentElement.setAttribute("data-theme", next);
    setMode(next);
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: next }));
  }

  return (
    <form method="post" action="/theme" className={classes.form}>
      <input type="hidden" name="return" value={pathname} />
      <span id={labelId}>{labels.group}</span>
      <span role="group" aria-labelledby={labelId} className={classes.group}>
        {storefrontThemeModes.map((option) => (
          <button
            key={option}
            type="submit"
            name="mode"
            value={option}
            aria-pressed={option === mode}
            onClick={(event) => choose(event, option)}
            className={classes.option}
          >
            {labels[option]}
          </button>
        ))}
      </span>
    </form>
  );
}
