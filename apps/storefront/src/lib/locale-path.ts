import { isLocale, type Locale } from "@fluxkit/ui";

/** The pages of emailed links: they take the token out of the address bar, so no link may carry it on (email plan step 10). */
const LINK_PAGE = /^account\/(reset-password|verify-email)$/;

/**
 * The same page in another locale: swaps the first path segment and keeps the rest, the query and the fragment. The
 * fragment is known only in the browser (`location.hash`, never sent to a server); on the guest order page it holds the
 * access token, which must survive a language change. The reset-password and verify-email pages are the exception: their
 * token is removed from the address bar on load and must not live on in a link, so a language change there needs the
 * emailed link again.
 */
export function switchLocalePath(pathname: string, target: Locale, search = "", hash = ""): string {
  const segments = pathname.split("/").filter((segment) => segment !== "");
  const [first, ...rest] = segments;
  if (first === undefined || !isLocale(first)) return `/${target}`;
  const path = [target, ...rest].join("/");
  const query = search === "?" ? "" : search;
  const fragment =
    hash.startsWith("#") && hash.length > 1 && !LINK_PAGE.test(rest.join("/")) ? hash : "";
  return `/${path}${query}${fragment}`;
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
