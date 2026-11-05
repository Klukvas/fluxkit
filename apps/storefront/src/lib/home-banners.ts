import type { HomeBanner } from "@fluxkit/api-client";
import { locales as storefrontLocales, type Locale } from "@fluxkit/ui";
import { MAX_BANNERS, type BannerTone, type ConfigBannersSection } from "../config/home";
import { allowedImageUrl } from "./image-source";

/**
 * Checks of the home page's `banners` section (plans 2026-11-05-home-banners.md and 2026-11-05-admin-home-banners.md).
 *
 * The link rule is the one of core `checkBannerLink` (`packages/core/src/content/banner-link.ts`), which the API applies when
 * an admin saves a banner. The storefront does not depend on `@fluxkit/core`, so it states the rule again and
 * `home-banners-parity.spec.ts` runs core's case table against it: the two agree on every row. It is applied twice here:
 * a config banner that fails it throws (the template's own code: the page fails in development and `config/home.spec.ts` in
 * CI), a banner of the API that fails it is skipped and logged (data: never a page error).
 */

const MAX_URL_LENGTH = 2048;
const ID = /^[a-z][a-z0-9-]*$/;

export type BannerHrefRefusal =
  | "empty"
  | "too_long"
  | "invalid_characters"
  | "not_path_or_https"
  | "protocol_relative"
  | "dot_segment"
  | "locale_prefix"
  | "credentials";

export type BannerHrefResult =
  { ok: true; kind: "path" | "https" } | { ok: false; reason: BannerHrefRefusal };

/** Whitespace (any Unicode space included), C0 and C1 controls, DEL, or a backslash: the URL parser drops or rewrites them. */
function hasBlankControlOrBackslash(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f) || /\s/u.test(char) || char === "\\") {
      return true;
    }
  }
  return false;
}

/** `.` or `..`, with any mix of `.` and `%2e` / `%2E`: a browser resolves it as a dot segment (PR 225 review minor). */
function isDotSegment(segment: string): boolean {
  const decoded = segment.replace(/%2e/giu, ".");
  return decoded === "." || decoded === "..";
}

function checkPath(href: string, locales: readonly string[]): BannerHrefResult {
  if (href.startsWith("//")) return { ok: false, reason: "protocol_relative" };
  // Split on `?` and `#` too, so `/a/..?x` is caught (and a `/../` inside the query, like core).
  const pieces = href.split(/[/?#]/u);
  if (pieces.some(isDotSegment)) return { ok: false, reason: "dot_segment" };
  // Links are stored without the locale: the storefront adds the shopper's one, so `/uk/x` would become `/en/uk/x`.
  const first = (pieces[1] ?? "").toLowerCase();
  if (locales.some((locale) => locale.toLowerCase() === first)) {
    return { ok: false, reason: "locale_prefix" };
  }
  return { ok: true, kind: "path" };
}

// WHATWG forbidden host code points plus `%` (core refuses a percent-encoded host too; whitespace and `\` are refused before).
const FORBIDDEN_HOST = /[#/:<>?@[\]^|%"{}`]/u;
const IPV6_LITERAL = /^\[[0-9a-f:.]+\]$/iu;
const PORT = /^\d{0,5}$/u;

function checkHttps(href: string): BannerHrefResult {
  if (!/^https:\/\//iu.test(href)) return { ok: false, reason: "not_path_or_https" };
  const rest = href.slice("https://".length);
  const authority = rest.slice(0, rest.search(/[/?#]|$/u));
  if (authority.includes("@")) return { ok: false, reason: "credentials" };
  const portSeparator = authority.startsWith("[")
    ? authority.indexOf(":", authority.indexOf("]"))
    : authority.indexOf(":");
  const host = portSeparator === -1 ? authority : authority.slice(0, portSeparator);
  const port = portSeparator === -1 ? "" : authority.slice(portSeparator + 1);
  const validHost = host.startsWith("[")
    ? IPV6_LITERAL.test(host)
    : host !== "" && !FORBIDDEN_HOST.test(host);
  if (!validHost || !PORT.test(port) || Number(port) > 65535) {
    return { ok: false, reason: "not_path_or_https" };
  }
  // The browser's own parser has the last word: it must agree that this is https with a host and no credentials.
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { ok: false, reason: "not_path_or_https" };
  }
  if (url.protocol !== "https:" || url.hostname === "") {
    return { ok: false, reason: "not_path_or_https" };
  }
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "credentials" };
  return { ok: true, kind: "https" };
}

/**
 * The link rule of a home banner, the same as core `checkBannerLink`: a storefront path (one leading `/`, no `//`, no `.` or
 * `..` segment even as `%2e`, no leading segment that is one of `locales`) or an `https://` address with a host and no
 * credentials; never whitespace, a control character or a backslash; at most 2048 characters.
 */
export function checkBannerHref(
  href: string,
  locales: readonly string[] = storefrontLocales,
): BannerHrefResult {
  if (href.length === 0) return { ok: false, reason: "empty" };
  if (href.length > MAX_URL_LENGTH) return { ok: false, reason: "too_long" };
  if (hasBlankControlOrBackslash(href)) return { ok: false, reason: "invalid_characters" };
  return href.startsWith("/") ? checkPath(href, locales) : checkHttps(href);
}

export interface BannerLink {
  href: string;
  /** An `https://` address outside the storefront: a plain `<a>`, not a client-side navigation. */
  external: boolean;
}

/** The link of a banner that passed `checkBannerHref`: a path gets the locale prefix, an address is normalized. */
function linkOf(locale: Locale, href: string, kind: "path" | "https"): BannerLink {
  if (kind === "https") return { href: new URL(href).href, external: true };
  return { href: href === "/" ? `/${locale}` : `/${locale}${href}`, external: false };
}

/**
 * Where a config banner links to (`checkBannerHref`, then the locale prefix for a path). Throws on a refused link: the config
 * is the template's own code.
 */
export function bannerLink(locale: Locale, href: string): BannerLink {
  const result = checkBannerHref(href);
  if (!result.ok) {
    throw new RangeError(`Banner link "${href}" is refused (${result.reason}).`);
  }
  return linkOf(locale, href, result.kind);
}

/** Throws when a config section lists more than `MAX_BANNERS` banners, or a banner id that is malformed or repeated. */
export function checkBannersSection(section: ConfigBannersSection): void {
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

/** The picture of a banner from the API, as the page renders it. */
export interface StoreBannerPicture {
  /** `allowedImageUrl` of the API's URL; `null` when the host is not allowed (the token placeholder, like product images). */
  src: string | null;
  width: number;
  height: number;
  /** `""` = decorative (a `card` without alt text). Never empty for the `image` layout: it names the link. */
  alt: string;
}

/** A banner of `GET /store/banners` that passed the storefront's checks, ready to render. */
export type StoreBannerView =
  | {
      id: string;
      layout: "card";
      title: string;
      text: string | null;
      tone: BannerTone;
      link: BannerLink;
      picture: StoreBannerPicture;
    }
  | { id: string; layout: "image"; link: BannerLink; picture: StoreBannerPicture };

/** Why a banner of the API is left out (a code for the log: no text of the banner is logged). */
export type StoreBannerSkip = "malformed" | `link_${BannerHrefRefusal}`;

const BANNER_ID = /^[0-9A-Za-z-]{1,64}$/;
const isText = (value: unknown): value is string => typeof value === "string" && value !== "";
const isSize = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

/** The checked banner, or why it is left out. The API is trusted for nothing the page relies on (AGENTS.md section 11). */
export function checkStoreBanner(
  banner: HomeBanner,
  locale: Locale,
  imageHosts: readonly string[],
): { ok: true; view: StoreBannerView } | { ok: false; reason: StoreBannerSkip } {
  const raw = banner as Partial<Record<keyof HomeBanner, unknown>>;
  const image = (raw.image ?? null) as Partial<Record<keyof HomeBanner["image"], unknown>> | null;
  if (
    typeof raw.id !== "string" ||
    !BANNER_ID.test(raw.id) ||
    (raw.layout !== "card" && raw.layout !== "image") ||
    (raw.tone !== "surface" && raw.tone !== "accent") ||
    typeof raw.href !== "string" ||
    image === null ||
    typeof image !== "object" ||
    typeof image.url !== "string" ||
    !isSize(image.width) ||
    !isSize(image.height) ||
    (image.alt !== null && typeof image.alt !== "string")
  ) {
    return { ok: false, reason: "malformed" };
  }
  const link = checkBannerHref(raw.href);
  if (!link.ok) return { ok: false, reason: `link_${link.reason}` };
  const picture: StoreBannerPicture = {
    src: allowedImageUrl(image.url, imageHosts),
    width: image.width,
    height: image.height,
    alt: typeof image.alt === "string" ? image.alt : "",
  };
  const id = raw.id;
  const href = linkOf(locale, raw.href, link.kind);
  if (raw.layout === "image") {
    // The picture is the only content: without its alt text the link would have no name.
    if (picture.alt === "") return { ok: false, reason: "malformed" };
    return { ok: true, view: { id, layout: "image", link: href, picture } };
  }
  if (!isText(raw.title) || (raw.text !== null && typeof raw.text !== "string")) {
    return { ok: false, reason: "malformed" };
  }
  return {
    ok: true,
    view: {
      id,
      layout: "card",
      title: raw.title,
      text: isText(raw.text) ? raw.text : null,
      tone: raw.tone,
      link: href,
      picture,
    },
  };
}

/**
 * The banners of one `GET /store/banners` answer that the page shows: at most `MAX_BANNERS` (the API sends no more; a 4th
 * is never shown, also not in place of a skipped one), each checked by `checkStoreBanner`. A skipped banner and a picture
 * whose host is not allowed are logged with the banner id and a code only (no text, no URL: AGENTS.md section 11).
 */
export function storeBannerViews(
  banners: readonly HomeBanner[],
  locale: Locale,
  imageHosts: readonly string[],
  warn: (message: string) => void = console.warn,
): StoreBannerView[] {
  if (banners.length > MAX_BANNERS) {
    warn(
      `GET /store/banners returned ${String(banners.length)} banners; only the first ${String(MAX_BANNERS)} are shown.`,
    );
  }
  const views: StoreBannerView[] = [];
  for (const banner of banners.slice(0, MAX_BANNERS)) {
    const checked = checkStoreBanner(banner, locale, imageHosts);
    const id = typeof banner.id === "string" && BANNER_ID.test(banner.id) ? banner.id : "unknown";
    if (!checked.ok) {
      warn(`Home banner ${id} is not shown: ${checked.reason}.`);
      continue;
    }
    if (checked.view.picture.src === null) {
      warn(
        `Home banner ${id} shows a placeholder: its picture's host is not allowed (STOREFRONT_IMAGE_HOSTS, https only).`,
      );
    }
    views.push(checked.view);
  }
  return views;
}
