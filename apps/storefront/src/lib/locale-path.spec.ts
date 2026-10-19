import { describe, expect, it } from "vitest";
import { localizedHref, switchLocalePath } from "./locale-path";

describe("switchLocalePath", () => {
  it.each([
    ["/uk", "en", "/en"],
    ["/en", "uk", "/uk"],
    ["/uk/", "en", "/en"],
    ["/uk/catalog", "en", "/en/catalog"],
    ["/uk/c/shoes/boots", "en", "/en/c/shoes/boots"],
    ["/en/p/some-product", "uk", "/uk/p/some-product"],
  ])("%s to %s is %s", (pathname, target, expected) => {
    expect(switchLocalePath(pathname, target as "uk" | "en")).toBe(expected);
  });

  it("keeps the query string", () => {
    expect(switchLocalePath("/uk/catalog", "en", "?page=2&brand=acme")).toBe(
      "/en/catalog?page=2&brand=acme",
    );
    expect(switchLocalePath("/uk/catalog", "en", "")).toBe("/en/catalog");
    expect(switchLocalePath("/uk/catalog", "en", "?")).toBe("/en/catalog");
  });

  it("keeps the URL fragment (the guest order page's token) after the query", () => {
    expect(switchLocalePath("/uk/order/7K3M-9QX2", "en", "", "#t=abc_DEF-123")).toBe(
      "/en/order/7K3M-9QX2#t=abc_DEF-123",
    );
    expect(switchLocalePath("/uk/catalog", "en", "?page=2", "#main-content")).toBe(
      "/en/catalog?page=2#main-content",
    );
    expect(switchLocalePath("/uk/catalog", "en", "", "#")).toBe("/en/catalog");
    expect(switchLocalePath("/uk/catalog", "en", "", "")).toBe("/en/catalog");
    // A value that is not a fragment is never appended.
    expect(switchLocalePath("/uk/catalog", "en", "", "t=abc")).toBe("/en/catalog");
  });

  it("falls back to the locale's home for a path without a known locale", () => {
    expect(switchLocalePath("/", "en")).toBe("/en");
    expect(switchLocalePath("/fr/catalog", "en")).toBe("/en");
    expect(switchLocalePath("", "uk")).toBe("/uk");
  });

  it("does not treat a path that merely starts with a locale as localized", () => {
    expect(switchLocalePath("/ukulele", "en")).toBe("/en");
  });
});

describe("localizedHref", () => {
  it("prefixes a storefront path with the locale", () => {
    expect(localizedHref("uk", "/catalog")).toBe("/uk/catalog");
    expect(localizedHref("en", "/c/shoes")).toBe("/en/c/shoes");
    expect(localizedHref("en", "/")).toBe("/en");
  });

  it.each(["catalog", "//evil.example/x", "https://evil.example", "/\\evil.example", "/a/../b"])(
    "refuses %s: only plain storefront paths are links",
    (href) => {
      expect(() => localizedHref("uk", href)).toThrow(RangeError);
    },
  );
});
