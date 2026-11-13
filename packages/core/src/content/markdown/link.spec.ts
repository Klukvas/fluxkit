import { describe, expect, it } from "vitest";
import { checkMarkdownLink } from "./link.js";
import type { MarkdownLinkRefusal } from "./types.js";

const LOCALES = ["uk", "en"] as const;

/** Link targets of a Markdown body (ADR 0050): the banner link rule plus control and bidi characters, raw or percent-encoded. */
const ACCEPTED: readonly [string, "path" | "https"][] = [
  ["/", "path"],
  ["/catalog", "path"],
  ["/catalog/shoes?sort=price#top", "path"],
  ["/products/coffee%20beans", "path"],
  ["/search?q=%D0%BA%D0%B0%D0%B2%D0%B0", "path"],
  ["https://example.com", "https"],
  ["https://example.com/wiki/Foo_(bar)", "https"],
  ["https://example.com/sale?x=1#y", "https"],
  ["https://example.com/%E2%80%94dash", "https"],
];

const REFUSED: readonly [string, MarkdownLinkRefusal][] = [
  ["", "empty"],
  ["catalog", "not_path_or_https"],
  ["./catalog", "not_path_or_https"],
  ["http://example.com", "not_path_or_https"],
  ["javascript:alert(1)", "not_path_or_https"],
  ["JAVASCRIPT:alert(1)", "not_path_or_https"],
  ["data:text/html,x", "not_path_or_https"],
  ["mailto:shop@example.com", "not_path_or_https"],
  ["vbscript:x", "not_path_or_https"],
  // Stricter than the banner rule: the scheme is written in lower case (one spelling for the renderer's own check).
  ["HTTPS://example.com", "not_path_or_https"],
  ["Https://example.com", "not_path_or_https"],
  [" https://example.com", "not_path_or_https"],
  ["//example.com", "protocol_relative"],
  ["/a/../b", "dot_segment"],
  ["/%2e%2e/admin", "dot_segment"],
  ["/%2E%2e", "dot_segment"],
  ["/uk/x", "locale_prefix"],
  ["/EN", "locale_prefix"],
  ["https://user:pass@example.com", "credentials"],
  ["/catalog\\x", "invalid_characters"],
  ["/catalog x", "invalid_characters"],
  // Raw control characters.
  ["/catalog\r", "control_character"],
  ["/catalog\nx", "control_character"],
  ["/catalog\tx", "control_character"],
  ["/catalog\u0000", "control_character"],
  ["/catalog\u0001", "control_character"],
  ["/catalog\u007f", "control_character"],
  ["/catalog\u0085", "control_character"],
  ["https://example.com/\u009b", "control_character"],
  // Percent-encoded control characters (C0, DEL, C1 as UTF-8, line and paragraph separators).
  ["/catalog%0d", "control_character"],
  ["/catalog%0D%0ASet-Cookie:x", "control_character"],
  ["/catalog%0a", "control_character"],
  ["/catalog%09", "control_character"],
  ["/catalog%00", "control_character"],
  ["/catalog%1F", "control_character"],
  ["/catalog%7f", "control_character"],
  ["/catalog%C2%85", "control_character"],
  ["/catalog%c2%9f", "control_character"],
  ["https://example.com/%e2%80%a8", "control_character"],
  ["https://example.com/?q=%E2%80%A9", "control_character"],
  // Raw bidi controls.
  ["/catalog‎", "bidi_control"],
  ["/catalog‏", "bidi_control"],
  ["/catalog‪", "bidi_control"],
  ["/catalog‮", "bidi_control"],
  ["https://example.com/‮gpj.exe", "bidi_control"],
  ["/catalog⁦", "bidi_control"],
  ["/catalog⁩", "bidi_control"],
  ["/catalog؜", "bidi_control"],
  // Percent-encoded bidi controls (UTF-8).
  ["/catalog%E2%80%8E", "bidi_control"],
  ["/catalog%e2%80%8f", "bidi_control"],
  ["/catalog%E2%80%AA", "bidi_control"],
  ["/catalog%E2%80%AE", "bidi_control"],
  ["https://example.com/%e2%80%ae", "bidi_control"],
  ["/catalog%E2%81%A6", "bidi_control"],
  ["/catalog%E2%81%A9", "bidi_control"],
  ["/catalog%D8%9C", "bidi_control"],
];

describe("checkMarkdownLink", () => {
  it.each(ACCEPTED)("accepts %j as %s", (href, kind) => {
    expect(checkMarkdownLink(href, LOCALES)).toEqual({ ok: true, kind });
  });

  it.each(REFUSED)("refuses %j (%s)", (href, reason) => {
    expect(checkMarkdownLink(href, LOCALES)).toEqual({ ok: false, reason });
  });

  it("keeps percent-encoded characters that are neither controls nor bidi controls", () => {
    // U+2028 / U+2029 are refused, their neighbours U+2027 and U+202F are not; U+2065 and U+206A border the isolates.
    for (const href of [
      "/a%E2%80%A7",
      "/a%E2%80%AF",
      "/a%E2%81%A5",
      "/a%E2%81%AA",
      "/a%C2%A0",
      "/a%20b",
    ]) {
      expect(checkMarkdownLink(href, LOCALES), href).toEqual({ ok: true, kind: "path" });
    }
  });
});
