import type { Locale } from "@fluxkit/ui";
import { MAX_BANNERS, type BannersSection } from "../config/home";
import { localizedHref } from "./locale-path";

/**
 * Checks of the home page's `banners` section (plan 2026-11-05-home-banners.md). The config is the template's own code, so
 * a bad entry throws: the home page fails on its first render in development and `config/home.spec.ts` fails in CI, rather
 * than a card linking somewhere unsafe or a banner silently missing.
 */

const MAX_URL_LENGTH = 2048;
const ID = /^[a-z][a-z0-9-]*$/;

export interface BannerLink {
  href: string;
  /** An `https://` address outside the storefront: a plain `<a>`, not a client-side navigation. */
  external: boolean;
}

/** True when the text holds whitespace or a control character (the URL parser silently drops a tab or a newline). */
function hasBlankOrControl(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f) || /\s/.test(char)) return true;
  }
  return false;
}

function httpsAddress(href: string): string {
  const refuse = (why: string) => new RangeError(`Banner link "${href}" is refused: ${why}.`);
  if (href.length > MAX_URL_LENGTH)
    throw refuse(`longer than ${String(MAX_URL_LENGTH)} characters`);
  if (hasBlankOrControl(href) || href.includes("\\"))
    throw refuse("whitespace, a control character or a backslash");
  if (!/^https:\/\/[^/]/i.test(href))
    throw refuse("only a storefront path or an https:// address is allowed");
  const url = new URL(href);
  if (url.protocol !== "https:" || url.hostname === "") throw refuse("no https host");
  if (url.username !== "" || url.password !== "") throw refuse("credentials in the address");
  return url.href;
}

/**
 * Where a banner card links to: a storefront path (`/catalog`) gets the locale prefix and is checked like the hero's link
 * (`localizedHref`: no `//`, `\` or `..`); an absolute address must be `https` with a host and no credentials. Throws otherwise
 * (`http:`, `javascript:`, `data:`, `mailto:`, a relative path without `/`).
 */
export function bannerLink(locale: Locale, href: string): BannerLink {
  if (href.startsWith("/")) return { href: localizedHref(locale, href), external: false };
  return { href: httpsAddress(href), external: true };
}

/** Throws when the section lists more than `MAX_BANNERS` banners, or a banner id that is malformed or repeated. */
export function checkBannersSection(section: BannersSection): void {
  const items: readonly { id: string }[] = section.items;
  if (items.length > MAX_BANNERS) {
    throw new RangeError(
      `Home section "${section.id}" lists ${String(items.length)} banners; at most ${String(MAX_BANNERS)} are shown in one row.`,
    );
  }
  const seen = new Set<string>();
  for (const { id } of items) {
    if (!ID.test(id))
      throw new RangeError(`Banner id "${id}" of "${section.id}" is not a lowercase slug.`);
    if (seen.has(id)) throw new RangeError(`Banner id "${id}" appears twice in "${section.id}".`);
    seen.add(id);
  }
}
