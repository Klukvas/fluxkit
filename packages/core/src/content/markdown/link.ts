import { checkBannerLink } from "../banner-link.js";
import type { MarkdownLinkRefusal } from "./types.js";

export type MarkdownLinkResult =
  | { readonly ok: true; readonly kind: "path" | "https" }
  | { readonly ok: false; readonly reason: MarkdownLinkRefusal };

/** C0 controls (tab, CR, LF and NUL included), DEL and C1 controls. */
function isControl(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

/** Bidi controls: ALM, LRM, RLM, the embeddings and overrides (U+202A to U+202E) and the isolates (U+2066 to U+2069). */
function isBidiControl(code: number): boolean {
  return (
    code === 0x061c ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

/**
 * Invisible format characters (soft hyphen, zero-width space, joiners, word joiner, BOM, Mongolian vowel separator): the
 * address would differ from what the admin sees (`exa\u00ADmple.com`).
 */
function isFormatCharacter(code: number): boolean {
  return (
    code === 0x00ad ||
    (code >= 0x200b && code <= 0x200d) ||
    code === 0x2060 ||
    code === 0xfeff ||
    code === 0x180e
  );
}

function hasCharacter(text: string, matches: (code: number) => boolean): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (matches(text.charCodeAt(index))) return true;
  }
  return false;
}

/**
 * The same characters percent-encoded as UTF-8 (one decoding, like a browser): C0 and DEL (`%00`-`%1F`, `%7F`), C1 (`%C2%80`-
 * `%C2%9F`), the line and paragraph separators U+2028/U+2029, and the bidi controls above. Fixed-length alternatives only, so
 * the expression cannot backtrack.
 */
const ENCODED_CONTROL = /%(?:[01][0-9a-f]|7f|c2%[89][0-9a-f]|e2%80%a[89])/iu;
const ENCODED_BIDI = /%(?:d8%9c|e2%80%(?:8[ef]|a[a-e])|e2%81%a[6-9])/iu;
const ENCODED_FORMAT = /%(?:c2%ad|e2%80%8[b-d]|e2%81%a0|ef%bb%bf|e1%a0%8e)/iu;

/**
 * The link rule of a Markdown body (ADR 0050): the home banner rule (`checkBannerLink`: a storefront path without `//`, dot
 * segments or a locale prefix, or an `https` address with a host and no credentials), with the scheme written exactly
 * `https://`, and no control, bidi control or invisible format character, raw or percent-encoded.
 */
export function checkMarkdownLink(href: string, locales: readonly string[]): MarkdownLinkResult {
  if (hasCharacter(href, isControl) || ENCODED_CONTROL.test(href)) {
    return { ok: false, reason: "control_character" };
  }
  if (hasCharacter(href, isBidiControl) || ENCODED_BIDI.test(href)) {
    return { ok: false, reason: "bidi_control" };
  }
  if (hasCharacter(href, isFormatCharacter) || ENCODED_FORMAT.test(href)) {
    return { ok: false, reason: "format_character" };
  }
  if (href !== "" && !href.startsWith("/") && !href.startsWith("https://")) {
    return { ok: false, reason: "not_path_or_https" };
  }
  return checkBannerLink(href, locales);
}
