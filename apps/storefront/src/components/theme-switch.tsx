"use client";

import type { ThemeMode } from "@fluxkit/theme";
import { usePathname } from "next/navigation";
import { useId, useState, type MouseEvent, type ReactNode } from "react";
import { storefrontThemeModes, themeCookie } from "../lib/theme-mode";
import { DeviceIcon, MoonIcon, SunIcon } from "./icons";
import { focusRing } from "./styles";

export interface ThemeSwitchLabels {
  /** Name of the group ("Theme"). */
  group: string;
  light: string;
  dark: string;
  system: string;
}

const icons: Record<ThemeMode, () => ReactNode> = {
  light: () => <SunIcon />,
  dark: () => <MoonIcon />,
  system: () => <DeviceIcon />,
};

/**
 * The footer's Light / Dark / System switch (plan 2026-11-03-storefront-design-b.md, decision 5): three buttons with
 * `aria-pressed` in a labelled group. Without a script it is a plain form: the browser posts the choice to `/theme`
 * (`app/theme/route.ts`), which stores it and sends the shopper back to this path. With a script the choice applies in
 * place: the cookie is written here (the one place in the storefront that writes a cookie, guarded by a spec) and
 * `<html data-theme>` changes at once, so the next page the server renders matches.
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
      <span id={labelId} className="text-sm">
        {labels.group}
      </span>
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-1">
        {storefrontThemeModes.map((option) => {
          const pressed = option === mode;
          return (
            <button
              key={option}
              type="submit"
              name="mode"
              value={option}
              aria-pressed={pressed}
              data-theme-option={option}
              onClick={(event) => choose(event, option)}
              className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm ${focusRing} ${
                pressed
                  ? "border-primary bg-primary font-semibold text-primary-foreground"
                  : "border-border bg-background text-foreground hover:bg-muted"
              }`}
            >
              {icons[option]()}
              <span>{labels[option]}</span>
            </button>
          );
        })}
      </div>
    </form>
  );
}
