import {
  BANNER_LIMITS as coreLimits,
  BANNER_WINDOW_BOUNDS as coreBounds,
  checkBannerLink as coreCheck,
  checkBannerWindow,
  codePointLength as coreLength,
} from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import {
  BANNER_LIMITS,
  BANNER_WINDOW_BOUNDS,
  checkBannerLink,
  codePointLength,
  inWindowBounds,
} from "./banner-rules";

/**
 * The admin repeats core's banner rules (core is a dev dependency of the admin and never in its bundle). Every case below
 * runs through both, so a change of core's rule fails here until the admin copy follows. The rows mirror core's own case
 * table (`packages/core/src/content/banner-link.spec.ts`) plus the edge cases of its other tests.
 */
const LINKS: readonly string[] = [
  "/",
  "/catalog",
  "/catalog/shoes?sort=price#top",
  "/search?q=a.b",
  "/products/a..b",
  "/.well-known-ish",
  "/ukraine",
  "/english/x",
  "/%2e%2ex",
  "https://example.com",
  "https://example.com/sale?x=1#y",
  "HTTPS://Example.COM/x",
  "https://example.com:8443/x",
  "",
  "catalog",
  "./catalog",
  "../catalog",
  "http://example.com",
  "javascript:alert(1)",
  "JavaScript:alert(1)",
  "data:text/html,<b>x</b>",
  "mailto:shop@example.com",
  "ftp://example.com",
  "https:/example.com",
  "https:///example.com",
  "//example.com",
  "//example.com/x",
  "/\\example.com",
  "https://example.com\\@evil.test",
  "/catalog page",
  "/catalog\tx",
  "/catalog\nx",
  "https://example.com/\r",
  "/catalog\u0000",
  "/catalog\u007f",
  "/catalog\u0085",
  "/catalog ",
  "/catalog ",
  " /catalog",
  "/..",
  "/.",
  "/a/../b",
  "/a/./b",
  "/a/..",
  "/a/..?x=1",
  "/a/..#top",
  "/search?q=/../x",
  "/%2e%2e/admin",
  "/%2E%2E/admin",
  "/a/%2e/b",
  "/a/.%2e/b",
  "/a/%2e.",
  "/uk",
  "/uk/catalog",
  "/en/catalog",
  "/UK/catalog",
  "/uk?x=1",
  "/en#top",
  "/pl/catalog",
  "/catalog/uk",
  "https://user:secret@example.com/x",
  "https://user@example.com/x",
  "https://:443/x",
  "https://exa mple.com",
  "https://[::1",
  "https://[::1]x/",
  "https://example.com:99999/x",
  "https://example.com:8a/x",
  "https://exa<mple.com",
  "https://exa%41mple.com",
  "https://exa|mple.com",
  "https://[::1]/x",
  "https://[2001:db8::1]:8443/x",
  "https://example.com:/x",
  "https://магазин.укр/акції",
  "https://example.com?x=1",
  "https://example.com#top",
  `/${"a".repeat(2047)}`,
  `/${"a".repeat(2048)}`,
];

describe("banner rules copied from core", () => {
  it("have the same limits and window bounds as core", () => {
    expect({ ...BANNER_LIMITS }).toEqual({ ...coreLimits });
    expect({ ...BANNER_WINDOW_BOUNDS }).toEqual({ ...coreBounds });
  });

  it.each(LINKS.map((href) => [JSON.stringify(href).slice(0, 60), href]))(
    "check the link %s exactly as core does",
    (_label, href) => {
      for (const locales of [["uk", "en"], ["uk", "en", "pl"], []] as const) {
        expect(checkBannerLink(href, locales)).toEqual(coreCheck(href, locales));
      }
    },
  );

  it("count characters as core does (code points, not UTF-16 units)", () => {
    for (const text of ["", "abc", "Знижки", "😀😀", "é"]) {
      expect(codePointLength(text)).toBe(coreLength(text));
    }
  });

  it("find an instant outside the window exactly where core does", () => {
    for (const instant of [
      coreBounds.min - 1,
      coreBounds.min,
      coreBounds.maxExclusive - 1,
      coreBounds.maxExclusive,
      Date.UTC(2026, 10, 5),
      Number.NaN,
    ]) {
      const date = new Date(instant);
      const core = checkBannerWindow(date, null);
      expect(inWindowBounds(instant), String(instant)).toBe(core.length === 0);
    }
  });
});
