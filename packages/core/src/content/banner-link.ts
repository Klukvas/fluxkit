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
// WHATWG forbidden host code points (whitespace, controls and `\` are refused before) plus `%`, and the characters IDNA maps
// to a dot (one dot leader, ideographic and full-width full stops): `example.com․evil.test` would name another host.
const FORBIDDEN_HOST = /[#/:<>?@[\]^|%"{}`\u2024\u3002\uFF0E\uFF61]/u;
const PORT = /^\d{0,5}$/u;
const IPV4_PART = /^(?:0|[1-9]\d{0,2})$/u;
const IPV6_GROUP = /^[0-9a-f]{1,4}$/iu;

/** A dotted IPv4 address: exactly four decimal parts from 0 to 255 (no leading zeros, no other notation). */
function isDottedIpv4(host: string): boolean {
  const parts = host.split(".");
  return parts.length === 4 && parts.every((part) => IPV4_PART.test(part) && Number(part) <= 255);
}

/**
 * An IPv6 literal without its brackets: hex groups of 1 to 4 digits, at most one `::`, 8 groups in all (fewer only with `::`),
 * an optional trailing dotted IPv4 counting as two groups.
 */
function isIpv6(literal: string): boolean {
  const halves = literal.split("::");
  if (halves.length > 2) return false;
  const groupsOf = (half: string): string[] => (half === "" ? [] : half.split(":"));
  const all = halves.flatMap(groupsOf);
  let count = 0;
  for (const [index, group] of all.entries()) {
    if (index === all.length - 1 && group.includes(".")) {
      if (!isDottedIpv4(group)) return false;
      count += 2;
    } else if (IPV6_GROUP.test(group)) {
      count += 1;
    } else {
      return false;
    }
  }
  return halves.length === 2 ? count <= 7 : count === 8;
}

/**
 * A host name or address a browser can reach: a bracketed IPv6 literal, or a name without forbidden characters whose last
 * label is not all digits unless the whole host is a dotted IPv4 (WHATWG reads such a host as a number: `999.1.1.1`,
 * `1.2.3.4.5` and `shop.123` are refused by the URL parser).
 */
function isValidHost(host: string): boolean {
  if (host.startsWith("[")) {
    return host.endsWith("]") && isIpv6(host.slice(1, -1));
  }
  if (host === "" || FORBIDDEN_HOST.test(host)) return false;
  const labels = host.split(".");
  const last = labels.at(-1) === "" ? labels.at(-2) : labels.at(-1);
  if (last !== undefined && (/^\d+$/u.test(last) || /^0x[0-9a-f]*$/iu.test(last))) {
    return isDottedIpv4(host);
  }
  return true;
}

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
  if (!isValidHost(host) || !PORT.test(port) || Number(port) > 65535) {
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
