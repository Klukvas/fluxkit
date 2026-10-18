import { isLocale, type Locale } from "@fluxkit/ui";

/** The same page in another locale: swaps the first path segment and keeps the rest and the query. */
export function switchLocalePath(pathname: string, target: Locale, search = ""): string {
  const segments = pathname.split("/").filter((segment) => segment !== "");
  const [first, ...rest] = segments;
  if (first === undefined || !isLocale(first)) return `/${target}`;
  const path = [target, ...rest].join("/");
  const query = search === "?" ? "" : search;
  return `/${path}${query}`;
}

/**
 * A link target from a layout config (`src/layout/navigation.ts`): a path starting with one `/`, no scheme, no `//`, no
 * backslash and no dot segments, so a config entry can never become an external or odd URL.
 */
export function localizedHref(locale: Locale, href: string): string {
  if (
    !href.startsWith("/") ||
    href.startsWith("//") ||
    href.includes("\\") ||
    /(^|\/)\.\.?(\/|$)/.test(href)
  ) {
    throw new RangeError(`"${href}" is not a plain storefront path.`);
  }
  return href === "/" ? `/${locale}` : `/${locale}${href}`;
}
