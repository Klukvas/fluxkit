"use client";

import type { ThemeMode } from "@fluxkit/theme";
import { usePathname } from "next/navigation";
import { useId, useState, type MouseEvent } from "react";
import { storefrontThemeModes, themeCookie } from "../lib/theme-mode";

export interface ThemeSwitchLabels {
  /** Name of the group ("Theme"). */
  group: string;
  light: string;
  dark: string;
  system: string;
}

/**
 * The footer's Light / Dark / System switch (plan 2026-11-03-storefront-design-b.md, decision 5): three buttons with
 * `aria-pressed` in a labelled group. Without a script it is a plain form: the browser posts the choice to `/theme`
 * (`app/theme/route.ts`), which stores it and sends the shopper back to this path. With a script the choice applies in
 * place: the cookie is written here (one of the two places in the storefront that write a cookie, guarded by a spec) and
 * `<html data-theme>` changes at once, so the next page the server renders matches. Text buttons and one class
 * (`.fk-theme-option`): the footer is part of every page's first HTML, which has a size budget (README, "Keep the header small").
 */
export function ThemeSwitch({
  initialMode,
  labels,
}: {
  /** The mode the server rendered `<html data-theme>` with. */
  initialMode: ThemeMode;
  labels: ThemeSwitchLabels;
}) {
  const [mode, setMode] = useState(initialMode);
  const pathname = usePathname();
  const labelId = useId();

  function choose(event: MouseEvent<HTMLButtonElement>, next: ThemeMode) {
    event.preventDefault();
    document.cookie = themeCookie(next, { secure: window.location.protocol === "https:" });
    document.documentElement.setAttribute("data-theme", next);
    setMode(next);
  }

  return (
    <form method="post" action="/theme" className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="return" value={pathname} />
      <span id={labelId}>{labels.group}</span>
      <span role="group" aria-labelledby={labelId} className="flex flex-wrap gap-1">
        {storefrontThemeModes.map((option) => (
          <button
            key={option}
            type="submit"
            name="mode"
            value={option}
            aria-pressed={option === mode}
            onClick={(event) => choose(event, option)}
            className="fk-theme-option"
          >
            {labels[option]}
          </button>
        ))}
      </span>
    </form>
  );
}
