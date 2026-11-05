import { describe, expect, it } from "vitest";
import type { Banner, BannersSection } from "../config/home";
import { bannerLink, checkBannersSection } from "./home-banners";

// The banners section of the home page (plan 2026-11-05-home-banners.md): link and count checks.

function banner(id: string, href = "/catalog"): Banner {
  return {
    id,
    titleKey: "b.title",
    textKey: "b.text",
    href,
    image: { src: "/home/banner-1.svg", width: 640, height: 320, altKey: null },
  };
}

describe("bannerLink", () => {
  it("prefixes a storefront path with the locale, like the hero's link", () => {
    expect(bannerLink("uk", "/catalog")).toEqual({ href: "/uk/catalog", external: false });
    expect(bannerLink("en", "/c/demo-tools?brand=x")).toEqual({
      href: "/en/c/demo-tools?brand=x",
      external: false,
    });
    expect(bannerLink("en", "/")).toEqual({ href: "/en", external: false });
  });

  it("keeps an https address as a plain external link", () => {
    expect(bannerLink("uk", "https://example.com/sale")).toEqual({
      href: "https://example.com/sale",
      external: true,
    });
    expect(bannerLink("en", "HTTPS://Example.com")).toEqual({
      href: "https://example.com/",
      external: true,
    });
  });

  it.each([
    ["http (not https)", "http://example.com/"],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,hi"],
    ["mailto:", "mailto:shop@example.com"],
    ["a relative path without a slash", "catalog"],
    ["a protocol-relative address", "//example.com/"],
    ["a backslash trick", "/\\example.com"],
    ["a parent segment", "/catalog/../admin"],
    ["https without a host", "https:///path"],
    ["credentials", "https://user:secret@example.com/"],
    ["a tab inside", "https://exa\tmple.com/"],
    ["a space inside", "https://example.com/a b"],
    ["a backslash in an address", "https://example.com\\@evil.test/"],
    ["an empty value", ""],
    ["an over-long address", `https://example.com/${"a".repeat(2048)}`],
  ])("refuses %s", (_label, href) => {
    expect(() => bannerLink("uk", href)).toThrow();
  });
});

describe("checkBannersSection", () => {
  const section = (items: readonly Banner[]): BannersSection =>
    ({ kind: "banners", id: "banners", titleKey: "t", items }) as BannersSection;

  it("accepts 0 to 3 banners with distinct slug ids", () => {
    for (const count of [0, 1, 2, 3]) {
      const items = Array.from({ length: count }, (_, index) => banner(`b${String(index)}`));
      expect(() => {
        checkBannersSection(section(items));
      }).not.toThrow();
    }
  });

  it("refuses a fourth banner (a list built past the tuple type)", () => {
    const items = ["a", "b", "c", "d"].map((id) => banner(id));
    expect(() => {
      checkBannersSection(section(items));
    }).toThrow(/4 banners; at most 3/);
  });

  it("refuses a repeated or malformed id (it becomes part of an element id)", () => {
    expect(() => {
      checkBannersSection(section([banner("a"), banner("a")]));
    }).toThrow(/twice/);
    expect(() => {
      checkBannersSection(section([banner("Has Space")]));
    }).toThrow(/slug/);
  });
});
