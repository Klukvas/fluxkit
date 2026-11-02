import type { ThemeMode } from "@fluxkit/theme";
import { defaultLocale, isLocale } from "@fluxkit/ui";
import type { ThemeConfig } from "../config/theme";

/**
 * The shopper's theme choice (plan 2026-11-03-storefront-design-b.md, decision 5). Pure: the root layout reads the cookie
 * on the server and renders `<html data-theme>` from it (so the first paint is right, no script needed); the footer's switch
 * and the `/theme` route handler write it. The cookie holds one of three words, nothing personal, and is set only when the
 * shopper picks a theme.
 */

/** The storefront's only cookie (the cart and session cookies are the API's). Listed in `config/legal.ts`. */
export const THEME_COOKIE = "fluxkit_theme";

/** One year: a preference, kept until the shopper changes it or clears the browser's cookies. */
export const THEME_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/** The modes of `@fluxkit/theme` (`themeModes`; a spec keeps them equal), repeated so client code does not load the package. */
export const storefrontThemeModes: readonly ThemeMode[] = ["light", "dark", "system"];

export function parseThemeMode(value: string | null | undefined): ThemeMode | null {
  return storefrontThemeModes.find((mode) => mode === value) ?? null;
}

/** What `<html data-theme>` says: the stored choice while the switch is shown, else the configured default. */
export function resolveThemeMode(
  cookieValue: string | null | undefined,
  config: ThemeConfig,
): ThemeMode {
  if (!config.showToggle) return config.defaultMode;
  return parseThemeMode(cookieValue) ?? config.defaultMode;
}

/** The `Set-Cookie` / `document.cookie` text for a choice. `Secure` when the shop is served over https. */
export function themeCookie(mode: ThemeMode, options: { secure: boolean }): string {
  const parts = [
    `${THEME_COOKIE}=${mode}`,
    "Path=/",
    `Max-Age=${THEME_COOKIE_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
  ];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

const MAX_RETURN_LENGTH = 1024;

/**
 * Where the no-script switch form sends the shopper back to: a path of this storefront that starts with a locale, without
 * a query (the form only knows the path), without `//` or a backslash (which a browser could read as another host), with
 * printable characters only. Anything else returns to the default locale's home page: never an open redirect.
 */
export function safeThemeReturnPath(value: unknown): string {
  const fallback = `/${defaultLocale}`;
  if (typeof value !== "string" || value.length > MAX_RETURN_LENGTH) return fallback;
  if (!/^\/[A-Za-z0-9._~%!$&'()*+,;=:@/-]*$/.test(value)) return fallback;
  if (value.includes("//") || value.includes("%5c") || value.includes("%5C")) return fallback;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return fallback;
  }
  if (decoded.includes("//") || decoded.includes("\\")) return fallback;
  const locale = value.split("/")[1] ?? "";
  return isLocale(locale) ? value : fallback;
}
