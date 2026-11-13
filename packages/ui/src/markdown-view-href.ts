/**
 * The renderer's own link check (blog plan section 11: link schemes restricted at save AND at render). The API parses with
 * core's full rule (`checkMarkdownLink`); this narrower check only makes sure that whatever reaches the page is a storefront
 * path or an `https` address without whitespace, control or bidi characters (raw or percent-encoded). A link that fails it
 * renders as its text.
 */

const WHITESPACE = /^\s$/u;

/** The characters core's rule refuses anywhere in a target: C0 and C1 controls, DEL, backslash, bidi controls, whitespace. */
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
    WHITESPACE.test(char)
  );
}

/** The same characters percent-encoded as UTF-8, matched with fixed-length alternatives only (no backtracking). */
const ENCODED_UNSAFE =
  /%(?:[01][0-9a-f]|7f|c2%[89][0-9a-f]|d8%9c|e2%80%(?:8[ef]|a[89a-e])|e2%81%a[6-9])/iu;

function hasUnsafeCharacter(href: string): boolean {
  for (let index = 0; index < href.length; index += 1) {
    if (isUnsafeCharacter(href.charAt(index))) return true;
  }
  return ENCODED_UNSAFE.test(href);
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
    if (!href.startsWith("/") || href.startsWith("//")) return null;
    return href === "/" ? localePrefix || "/" : `${localePrefix}${href}`;
  }
  if (!href.startsWith(HTTPS_PREFIX)) return null;
  const rest = href.slice(HTTPS_PREFIX.length);
  const authorityEnd = rest.search(/[/?#]/u);
  const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
  return authority === "" || authority.includes("@") ? null : href;
}
