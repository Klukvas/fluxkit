import { describe, expect, it } from "vitest";
import { checkBannerHref, type BannerHrefRefusal } from "./home-banners";

/*
 * The storefront's banner link check must agree with core `checkBannerLink`, which the API applies when an admin saves a
 * banner (ADR 0046, plan 2026-11-05-admin-home-banners.md D2). The storefront does not depend on `@fluxkit/core`, so the
 * case table of `packages/core/src/content/banner-link.spec.ts` is COPIED here, row for row (like `media-limits-parity.spec.ts`
 * does for the media limits). When a row changes there, change it here too: a link the API accepts but the storefront refuses
 * is a banner that silently never shows; one the API refuses is never stored.
 */

const LOCALES = ["uk", "en"] as const;

// Copied from packages/core/src/content/banner-link.spec.ts (ACCEPTED).
const ACCEPTED: readonly [string, "path" | "https"][] = [
  ["/", "path"],
  ["/catalog", "path"],
  ["/catalog/shoes?sort=price#top", "path"],
  ["/search?q=a.b", "path"],
  ["/products/a..b", "path"],
  ["/.well-known-ish", "path"],
  ["/ukraine", "path"],
  ["/english/x", "path"],
  ["/%2e%2ex", "path"],
  ["https://example.com", "https"],
  ["https://example.com/sale?x=1#y", "https"],
  ["HTTPS://Example.COM/x", "https"],
  ["https://example.com:8443/x", "https"],
];

// Copied from packages/core/src/content/banner-link.spec.ts (REFUSED).
const REFUSED: readonly [string, BannerHrefRefusal][] = [
  ["", "empty"],
  ["catalog", "not_path_or_https"],
  ["./catalog", "not_path_or_https"],
  ["../catalog", "not_path_or_https"],
  ["http://example.com", "not_path_or_https"],
  ["javascript:alert(1)", "not_path_or_https"],
  ["JavaScript:alert(1)", "not_path_or_https"],
  ["data:text/html,<b>x</b>", "not_path_or_https"],
  ["mailto:shop@example.com", "not_path_or_https"],
  ["ftp://example.com", "not_path_or_https"],
  ["https:/example.com", "not_path_or_https"],
  ["https:///example.com", "not_path_or_https"],
  ["//example.com", "protocol_relative"],
  ["//example.com/x", "protocol_relative"],
  ["/\\example.com", "invalid_characters"],
  ["https://example.com\\@evil.test", "invalid_characters"],
  ["/catalog page", "invalid_characters"],
  ["/catalog\tx", "invalid_characters"],
  ["/catalog\nx", "invalid_characters"],
  ["https://example.com/\r", "invalid_characters"],
  ["/catalog\u0000", "invalid_characters"],
  ["/catalog\u007f", "invalid_characters"],
  ["/catalog\u0085", "invalid_characters"],
  ["/catalog ", "invalid_characters"],
  ["/catalog ", "invalid_characters"],
  [" /catalog", "invalid_characters"],
  ["/..", "dot_segment"],
  ["/.", "dot_segment"],
  ["/a/../b", "dot_segment"],
  ["/a/./b", "dot_segment"],
  ["/a/..", "dot_segment"],
  ["/a/..?x=1", "dot_segment"],
  ["/a/..#top", "dot_segment"],
  ["/search?q=/../x", "dot_segment"],
  ["/%2e%2e/admin", "dot_segment"],
  ["/%2E%2E/admin", "dot_segment"],
  ["/a/%2e/b", "dot_segment"],
  ["/a/.%2e/b", "dot_segment"],
  ["/a/%2e.", "dot_segment"],
  ["/uk", "locale_prefix"],
  ["/uk/catalog", "locale_prefix"],
  ["/en/catalog", "locale_prefix"],
  ["/UK/catalog", "locale_prefix"],
  ["/uk?x=1", "locale_prefix"],
  ["/en#top", "locale_prefix"],
  ["https://user:secret@example.com/x", "credentials"],
  ["https://user@example.com/x", "credentials"],
  ["https://example.com․evil.test/", "not_path_or_https"],
  ["https://1.2.3.4.5/", "not_path_or_https"],
  ["https://999.1.1.1/", "not_path_or_https"],
  ["https://shop.123/", "not_path_or_https"],
  ["https://[1::2::3]/", "not_path_or_https"],
  ["https://[1:2:3:4:5:6:7:8:9]/", "not_path_or_https"],
  ["https://[12345::1]/", "not_path_or_https"],
  ["https://[1:2:3:4:5:6:7:1.2.3.4]/", "not_path_or_https"],
  ["https://[::1.2.3.256]/", "not_path_or_https"],
  ["https://[1:2:3]/", "not_path_or_https"],
];

// The other rows of core's spec (its separate cases), each with core's answer.
const MORE: readonly [string, "path" | "https" | BannerHrefRefusal][] = [
  ["/pl/catalog", "path"],
  ["/catalog/uk", "path"],
  ["https://:443/x", "not_path_or_https"],
  ["https://exa mple.com", "invalid_characters"],
  ["https://[::1", "not_path_or_https"],
  ["https://[::1]x/", "not_path_or_https"],
  ["https://example.com:99999/x", "not_path_or_https"],
  ["https://example.com:8a/x", "not_path_or_https"],
  ["https://exa<mple.com", "not_path_or_https"],
  ["https://exa%41mple.com", "not_path_or_https"],
  ["https://exa|mple.com", "not_path_or_https"],
  ["https://[::1]/x", "https"],
  ["https://[2001:db8::1]:8443/x", "https"],
  ["https://example.com:/x", "https"],
  ["https://магазин.укр/акції", "https"],
  ["https://example.com?x=1", "https"],
  ["https://example.com#top", "https"],
  ["https://1.2.3.4/x", "https"],
  ["https://[1:2:3:4:5:6:7:8]/", "https"],
  ["https://[::]/", "https"],
  ["https://[::ffff:1.2.3.4]/", "https"],
  ["https://[1:2:3:4:5:6:1.2.3.4]/", "https"],
  ["https://shop.example/", "https"],
  ["https://123.example.com/", "https"],
];

describe("checkBannerHref agrees with core checkBannerLink on its case table", () => {
  it.each(ACCEPTED)("accepts %j as a %s link", (href, kind) => {
    expect(checkBannerHref(href, LOCALES)).toEqual({ ok: true, kind });
  });

  it.each(REFUSED)("refuses %j (%s)", (href, reason) => {
    expect(checkBannerHref(href, LOCALES)).toEqual({ ok: false, reason });
  });

  it.each(MORE)("answers %j with %s", (href, answer) => {
    const expected =
      answer === "path" || answer === "https"
        ? { ok: true, kind: answer }
        : { ok: false, reason: answer };
    expect(checkBannerHref(href, LOCALES)).toEqual(expected);
  });

  it("allows exactly 2048 characters and refuses 2049, for paths and addresses", () => {
    const path = `/${"a".repeat(2047)}`;
    expect(checkBannerHref(path, LOCALES)).toEqual({ ok: true, kind: "path" });
    expect(checkBannerHref(`${path}a`, LOCALES)).toEqual({ ok: false, reason: "too_long" });
    const prefix = "https://example.com/";
    const address = `${prefix}${"a".repeat(2048 - prefix.length)}`;
    expect(checkBannerHref(address, LOCALES)).toEqual({ ok: true, kind: "https" });
    expect(checkBannerHref(`${address}a`, LOCALES)).toEqual({ ok: false, reason: "too_long" });
  });

  it("refuses a leading segment only for the given locales (the storefront's own by default)", () => {
    expect(checkBannerHref("/pl/catalog", ["uk", "en", "pl"])).toEqual({
      ok: false,
      reason: "locale_prefix",
    });
    expect(checkBannerHref("/uk/catalog")).toEqual({ ok: false, reason: "locale_prefix" });
    expect(checkBannerHref("/en")).toEqual({ ok: false, reason: "locale_prefix" });
  });

  it("copies core's table without dropping rows (counts match the source spec)", () => {
    expect([ACCEPTED.length, REFUSED.length, MORE.length]).toEqual([13, 57, 24]);
  });
});
