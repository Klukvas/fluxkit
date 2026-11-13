/**
 * The renderer's own link check (blog plan section 11: link schemes restricted at save AND at render). The API parses with
 * core's full rule (`checkMarkdownLink`); this check repeats the parts that decide where the link goes: a storefront path
 * (no `//`, no dot segment even as `%2e`, no leading locale segment) or an `https` address with a host and no credentials,
 * without whitespace, control, bidi control or invisible format characters (raw or percent-encoded). A link that fails it
 * renders as its text.
 */

import { locales } from "./i18n";

const WHITESPACE = /^\s$/u;

/**
 * The characters core's rule refuses anywhere in a target: C0 and C1 controls, DEL, backslash, bidi controls, invisible format
 * characters (U+00AD, U+200B to U+200D, U+2060, U+FEFF, U+180E) and whitespace.
 */
function isUnsafeCharacter(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x5c ||
    code === 0x061c ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0x00ad ||
    (code >= 0x200b && code <= 0x200d) ||
    code === 0x2060 ||
    code === 0xfeff ||
    code === 0x180e ||
    WHITESPACE.test(char)
  );
}

/** The same characters percent-encoded as UTF-8, matched with fixed-length alternatives only (no backtracking). */
const ENCODED_UNSAFE =
  /%(?:[01][0-9a-f]|7f|c2%[89][0-9a-f]|c2%ad|d8%9c|e2%80%(?:8[b-f]|a[89a-e])|e2%81%a[06-9]|ef%bb%bf|e1%a0%8e)/iu;

function hasUnsafeCharacter(href: string): boolean {
  for (let index = 0; index < href.length; index += 1) {
    if (isUnsafeCharacter(href.charAt(index))) return true;
  }
  return ENCODED_UNSAFE.test(href);
}

/** `.` or `..`, also written with `%2e` (a browser resolves it out of the path). */
function isDotSegment(segment: string): boolean {
  const decoded = segment.replace(/%2e/giu, ".");
  return decoded === "." || decoded === "..";
}

/**
 * A path the storefront can take as is: no `//` (another site), no dot segment, and no leading locale segment (the library's
 * locales or the prefix's own: the locale is added here, so `/uk/x` would become `/uk/uk/x`).
 */
function isStorefrontPath(href: string, localePrefix: string): boolean {
  if (!href.startsWith("/") || href.startsWith("//")) return false;
  const pieces = href.split(/[/?#]/u);
  if (pieces.some(isDotSegment)) return false;
  const first = (pieces[1] ?? "").toLowerCase();
  const reserved = [...locales, localePrefix.slice(1).toLowerCase()];
  return first === "" || !reserved.includes(first);
}

const HTTPS_PREFIX = "https://";
const LOCALE_PREFIX = /^(?:\/[A-Za-z0-9-]+)?$/u;

/** Throws for a prefix that could make a path leave the shop (`//host`, `https://...`): a programming error, never data. */
export function assertLocalePrefix(localePrefix: string): void {
  if (!LOCALE_PREFIX.test(localePrefix)) {
    throw new RangeError(
      `MarkdownView: localePrefix must be "" or "/<locale>", got "${localePrefix}".`,
    );
  }
}

/** Where a Markdown link points on the page, or null when it must not become a link. */
export function markdownViewHref(
  kind: "path" | "https",
  href: string,
  localePrefix: string,
): string | null {
  if (href === "" || hasUnsafeCharacter(href)) return null;
  if (kind === "path") {
    if (!isStorefrontPath(href, localePrefix)) return null;
    return href === "/" ? localePrefix || "/" : `${localePrefix}${href}`;
  }
  if (!href.startsWith(HTTPS_PREFIX)) return null;
  const rest = href.slice(HTTPS_PREFIX.length);
  const authorityEnd = rest.search(/[/?#]/u);
  const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
  return authority === "" || authority.includes("@") ? null : href;
}
