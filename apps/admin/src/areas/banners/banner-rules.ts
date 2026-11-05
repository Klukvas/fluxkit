/**
 * The home banner rules the form checks before sending (ADR 0046; core `packages/core/src/content`). The admin bundle never
 * imports `@fluxkit/core` (`source-guards.spec.ts`: it would pull zod and the whole core into the browser), so the rules
 * the form needs are repeated here and `banner-rules.spec.ts` runs them against core's own functions on the same cases
 * (core is a dev dependency of the admin). The server decides; its refusal is shown on the field it names.
 */

/** Core `BANNER_LIMITS`. */
export const BANNER_LIMITS = Object.freeze({
  maxStored: 50,
  maxShown: 3,
  titleMaxLength: 80,
  textMaxLength: 200,
  imageAltMaxLength: 150,
  linkMaxLength: 2048,
});

/** Core `BANNER_WINDOW_BOUNDS`: start and end in [2000-01-01, 2200-01-01) UTC. */
export const BANNER_WINDOW_BOUNDS = Object.freeze({
  min: Date.UTC(2000, 0, 1),
  maxExclusive: Date.UTC(2200, 0, 1),
});

export type BannerLinkRefusal =
  | "empty"
  | "too_long"
  | "invalid_characters"
  | "not_path_or_https"
  | "protocol_relative"
  | "dot_segment"
  | "locale_prefix"
  | "credentials";

export type BannerLinkResult =
  | { readonly ok: true; readonly kind: "path" | "https" }
  | { readonly ok: false; readonly reason: BannerLinkRefusal };

function refuse(reason: BannerLinkRefusal): BannerLinkResult {
  return { ok: false, reason };
}

function hasBlankControlOrBackslash(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f) || /\s/u.test(char) || char === "\\") {
      return true;
    }
  }
  return false;
}

function isDotSegment(segment: string): boolean {
  const decoded = segment.replace(/%2e/giu, ".");
  return decoded === "." || decoded === "..";
}

function checkPath(href: string, locales: readonly string[]): BannerLinkResult {
  if (href.startsWith("//")) return refuse("protocol_relative");
  const pieces = href.split(/[/?#]/u);
  if (pieces.some(isDotSegment)) return refuse("dot_segment");
  const first = (pieces[1] ?? "").toLowerCase();
  if (locales.some((locale) => locale.toLowerCase() === first)) return refuse("locale_prefix");
  return { ok: true, kind: "path" };
}

const HTTPS_PREFIX = /^https:\/\//iu;
const FORBIDDEN_HOST = /[#/:<>?@[\]^|%"{}`]/u;
const IPV6_LITERAL = /^\[[0-9a-f:.]+\]$/iu;
const PORT = /^\d{0,5}$/u;

function checkHttps(href: string): BannerLinkResult {
  if (!HTTPS_PREFIX.test(href)) return refuse("not_path_or_https");
  const rest = href.slice("https://".length);
  const authority = rest.slice(0, rest.search(/[/?#]|$/u));
  if (authority.includes("@")) return refuse("credentials");
  const portSeparator = authority.startsWith("[")
    ? authority.indexOf(":", authority.indexOf("]"))
    : authority.indexOf(":");
  const host = portSeparator === -1 ? authority : authority.slice(0, portSeparator);
  const port = portSeparator === -1 ? "" : authority.slice(portSeparator + 1);
  const validHost = host.startsWith("[")
    ? IPV6_LITERAL.test(host)
    : host !== "" && !FORBIDDEN_HOST.test(host);
  if (!validHost || !PORT.test(port) || Number(port) > 65535) return refuse("not_path_or_https");
  return { ok: true, kind: "https" };
}

/**
 * Core `checkBannerLink`: a storefront path (one leading `/`, no `//`, no `.`/`..` segment even as `%2e`, no leading
 * content-locale segment) or an `https` address with a host and no credentials; never whitespace, a control character
 * or a backslash; at most 2048 characters.
 */
export function checkBannerLink(href: string, locales: readonly string[]): BannerLinkResult {
  if (href.length === 0) return refuse("empty");
  if (href.length > BANNER_LIMITS.linkMaxLength) return refuse("too_long");
  if (hasBlankControlOrBackslash(href)) return refuse("invalid_characters");
  return href.startsWith("/") ? checkPath(href, locales) : checkHttps(href);
}

/** Length in Unicode code points, the way the API (core `codePointLength`) and Postgres count characters. */
export function codePointLength(text: string): number {
  return [...text].length;
}

/** Whether an instant lies in the API's window (core `checkBannerWindow`'s `out_of_range`). */
export function inWindowBounds(instant: number): boolean {
  return (
    !Number.isNaN(instant) &&
    instant >= BANNER_WINDOW_BOUNDS.min &&
    instant < BANNER_WINDOW_BOUNDS.maxExclusive
  );
}
