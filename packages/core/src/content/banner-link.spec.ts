import { describe, expect, it } from "vitest";
import { checkBannerLink, type BannerLinkRefusal } from "./banner-link.js";
import { BANNER_LIMITS } from "./limits.js";

const LOCALES = ["uk", "en"] as const;

/**
 * The case table of the link rule (plan 2026-11-05-admin-home-banners.md, D2). The storefront keeps its own check with a
 * parity spec over the same table (PR 3), so keep the rows plain data.
 */
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

const REFUSED: readonly [string, BannerLinkRefusal][] = [
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
  // Hosts the WHATWG parser refuses or that cannot name a real site (review M1 of PR 229): a banner with one would never show.
  ["https://example.com\u2024evil.test/", "not_path_or_https"],
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

describe("checkBannerLink", () => {
  it.each(ACCEPTED)("accepts %j as a %s link", (href, kind) => {
    expect(checkBannerLink(href, LOCALES)).toEqual({ ok: true, kind });
  });

  it.each(REFUSED)("refuses %j (%s)", (href, reason) => {
    expect(checkBannerLink(href, LOCALES)).toEqual({ ok: false, reason });
  });

  it("allows exactly 2048 characters and refuses 2049, for paths and addresses", () => {
    const path = `/${"a".repeat(BANNER_LIMITS.linkMaxLength - 1)}`;
    expect(path).toHaveLength(2048);
    expect(checkBannerLink(path, LOCALES)).toEqual({ ok: true, kind: "path" });
    expect(checkBannerLink(`${path}a`, LOCALES)).toEqual({ ok: false, reason: "too_long" });
    const prefix = "https://example.com/";
    const address = `${prefix}${"a".repeat(BANNER_LIMITS.linkMaxLength - prefix.length)}`;
    expect(address).toHaveLength(2048);
    expect(checkBannerLink(address, LOCALES)).toEqual({ ok: true, kind: "https" });
    expect(checkBannerLink(`${address}a`, LOCALES)).toEqual({ ok: false, reason: "too_long" });
  });

  it("refuses a leading segment only for the configured locales", () => {
    expect(checkBannerLink("/pl/catalog", LOCALES)).toEqual({ ok: true, kind: "path" });
    expect(checkBannerLink("/pl/catalog", ["uk", "en", "pl"])).toEqual({
      ok: false,
      reason: "locale_prefix",
    });
    // A later segment that happens to be a locale code is an ordinary path.
    expect(checkBannerLink("/catalog/uk", LOCALES)).toEqual({ ok: true, kind: "path" });
  });

  it("refuses an address whose host is empty after parsing", () => {
    expect(checkBannerLink("https://:443/x", LOCALES)).toEqual({
      ok: false,
      reason: "not_path_or_https",
    });
  });

  it("refuses an address the URL parser cannot read", () => {
    expect(checkBannerLink("https://exa mple.com", LOCALES)).toEqual({
      ok: false,
      reason: "invalid_characters",
    });
    for (const href of [
      "https://[::1",
      "https://[::1]x/",
      "https://example.com:99999/x",
      "https://example.com:8a/x",
      "https://exa<mple.com",
      "https://exa%41mple.com",
      "https://exa|mple.com",
    ]) {
      expect(checkBannerLink(href, LOCALES), href).toEqual({
        ok: false,
        reason: "not_path_or_https",
      });
    }
  });

  it("accepts an IPv6 literal, a port, an empty port and an international host", () => {
    for (const href of [
      "https://[::1]/x",
      "https://[2001:db8::1]:8443/x",
      "https://example.com:/x",
      "https://магазин.укр/акції",
      "https://example.com?x=1",
      "https://example.com#top",
      "https://1.2.3.4/x",
      "https://[1:2:3:4:5:6:7:8]/",
      "https://[::]/",
      "https://[::ffff:1.2.3.4]/",
      "https://[1:2:3:4:5:6:1.2.3.4]/",
      "https://shop.example/",
      "https://123.example.com/",
    ]) {
      expect(checkBannerLink(href, LOCALES), href).toEqual({ ok: true, kind: "https" });
    }
  });

  it("agrees with the WHATWG URL parser on every accepted address (no credentials, a host, https)", () => {
    // Core's types have no `URL` (it is pure); the spec runs on Node, which has it.
    const { URL: Parser } = globalThis as unknown as {
      URL: new (href: string) => {
        protocol: string;
        hostname: string;
        username: string;
        password: string;
      };
    };
    for (const [href, kind] of ACCEPTED) {
      if (kind !== "https") continue;
      const url = new Parser(href);
      expect(url.protocol).toBe("https:");
      expect(url.hostname).not.toBe("");
      expect(url.username + url.password).toBe("");
    }
  });
});
