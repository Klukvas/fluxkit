import { BANNER_LIMITS } from "./limits.js";

export type BannerLinkRefusal =
  | "empty"
  | "too_long"
  /** Whitespace, a control character or a backslash anywhere (the URL parser silently drops or rewrites them). */
  | "invalid_characters"
  /** Neither a storefront path (`/...`) nor an `https://host` address: `http:`, `javascript:`, `data:`, `mailto:`, `catalog`. */
  | "not_path_or_https"
  /** `//host`: a browser reads it as another site. */
  | "protocol_relative"
  /** A `.` or `..` segment, also percent-encoded (`%2e`): the browser resolves it out of the storefront path. */
  | "dot_segment"
  /** `/uk/...`: links are stored without a locale; the storefront adds the shopper's one. */
  | "locale_prefix"
  /** `https://user:password@host`. */
  | "credentials";

export type BannerLinkResult =
  | { readonly ok: true; readonly kind: "path" | "https" }
  | { readonly ok: false; readonly reason: BannerLinkRefusal };

function refuse(reason: BannerLinkRefusal): BannerLinkResult {
  return { ok: false, reason };
}

/** Whitespace (any Unicode space, NBSP and line separators included), C0 and C1 controls, DEL, or a backslash. */
function hasBlankControlOrBackslash(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f) || /\s/u.test(char) || char === "\\") {
      return true;
    }
  }
  return false;
}

/** `.` or `..`, with any mix of `.` and `%2e` / `%2E` (what a browser treats as a dot segment). */
function isDotSegment(segment: string): boolean {
  const decoded = segment.replace(/%2e/giu, ".");
  return decoded === "." || decoded === "..";
}

function checkPath(href: string, locales: readonly string[]): BannerLinkResult {
  if (href.startsWith("//")) {
    return refuse("protocol_relative");
  }
  // Split on `?` and `#` too, so `/a/..?x` is caught, and on `/` inside the query like the storefront's rule.
  const pieces = href.split(/[/?#]/u);
  if (pieces.some(isDotSegment)) {
    return refuse("dot_segment");
  }
  const first = (pieces[1] ?? "").toLowerCase();
  if (locales.some((locale) => locale.toLowerCase() === first)) {
    return refuse("locale_prefix");
  }
  return { ok: true, kind: "path" };
}

const HTTPS_PREFIX = /^https:\/\//iu;
// WHATWG forbidden host code points (whitespace, controls and `\` are refused before) plus `%`: a host never needs them.
const FORBIDDEN_HOST = /[#/:<>?@[\]^|%"{}`]/u;
const IPV6_LITERAL = /^\[[0-9a-f:.]+\]$/iu;
const PORT = /^\d{0,5}$/u;

/**
 * Core is pure (no `URL` global), so the authority of `https://authority/...` is read by hand: no `@` (credentials), a
 * non-empty host without forbidden characters (or a bracketed IPv6 literal) and an optional numeric port up to 65535.
 */
function checkHttps(href: string): BannerLinkResult {
  if (!HTTPS_PREFIX.test(href)) {
    return refuse("not_path_or_https");
  }
  const rest = href.slice("https://".length);
  const authority = rest.slice(0, rest.search(/[/?#]|$/u));
  if (authority.includes("@")) {
    return refuse("credentials");
  }
  const portSeparator = authority.startsWith("[")
    ? authority.indexOf(":", authority.indexOf("]"))
    : authority.indexOf(":");
  const host = portSeparator === -1 ? authority : authority.slice(0, portSeparator);
  const port = portSeparator === -1 ? "" : authority.slice(portSeparator + 1);
  const validHost = host.startsWith("[")
    ? IPV6_LITERAL.test(host)
    : host !== "" && !FORBIDDEN_HOST.test(host);
  if (!validHost || !PORT.test(port) || Number(port) > 65535) {
    return refuse("not_path_or_https");
  }
  return { ok: true, kind: "https" };
}

/**
 * The link rule of a home banner (ADR 0046, plan D2), one definition for the API and the admin form: a storefront path
 * (one leading `/`, no `//`, no `.`/`..` segments even percent-encoded, no leading locale segment of `locales`) or an
 * `https` address with a host and no credentials; never whitespace, control characters or a backslash; at most 2048
 * characters. The storefront keeps its own check with a parity spec over the same case table.
 */
export function checkBannerLink(href: string, locales: readonly string[]): BannerLinkResult {
  if (href.length === 0) {
    return refuse("empty");
  }
  if (href.length > BANNER_LIMITS.linkMaxLength) {
    return refuse("too_long");
  }
  if (hasBlankControlOrBackslash(href)) {
    return refuse("invalid_characters");
  }
  return href.startsWith("/") ? checkPath(href, locales) : checkHttps(href);
}
