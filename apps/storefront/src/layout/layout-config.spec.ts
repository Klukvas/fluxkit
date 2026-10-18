import { describe, expect, it } from "vitest";
import { checkoutConfig } from "../config/checkout";
import en from "../messages/en.json";
import uk from "../messages/uk.json";
import { homeSections } from "./home";
import { footerLinks, headerLinks, sessionLinks } from "./navigation";
import { localizedHref } from "../lib/locale-path";

const messageKeys = new Set(Object.keys(en));

function keysOf(props: object): string[] {
  return Object.entries(props)
    .filter(([name]) => name.endsWith("Key"))
    .map(([, value]) => value as string);
}

describe("home layout config", () => {
  it("lists each section type at most once, in a fixed order, hero first", () => {
    const types = homeSections.map((section) => section.type);
    expect(types).toEqual(["hero", "categoryTiles", "newProducts"]);
    expect(new Set(types).size).toBe(types.length);
  });

  it("refers only to message keys that exist in uk and en", () => {
    for (const section of homeSections) {
      for (const key of keysOf(section.props)) {
        expect(messageKeys.has(key), `${section.type}: ${key} in en`).toBe(true);
        expect(key in uk, `${section.type}: ${key} in uk`).toBe(true);
      }
    }
  });

  it("asks for a sensible number of new products", () => {
    const section = homeSections.find((candidate) => candidate.type === "newProducts");
    expect(section?.type === "newProducts" && section.props.limit).toBeGreaterThan(0);
    expect(section?.type === "newProducts" && section.props.limit).toBeLessThanOrEqual(100);
  });
});

describe("navigation config", () => {
  it("uses existing message keys and plain storefront paths", () => {
    for (const link of [...headerLinks, ...footerLinks]) {
      expect(messageKeys.has(link.labelKey), link.labelKey).toBe(true);
      expect(() => localizedHref("uk", link.href), link.href).not.toThrow();
    }
    for (const href of Object.values(sessionLinks)) {
      expect(() => localizedHref("en", href), href).not.toThrow();
    }
  });
});

describe("checkout config", () => {
  it("has a default country among the allowed ones, as upper-case ISO alpha-2 codes", () => {
    expect(checkoutConfig.defaultCountry).toBe("UA");
    expect(checkoutConfig.allowedShippingCountries).toContain(checkoutConfig.defaultCountry);
    for (const code of checkoutConfig.allowedShippingCountries) {
      expect(code).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("shows address fields once each, with city and the street line required", () => {
    const names = checkoutConfig.addressFields.map((field) => field.name);
    expect(new Set(names).size).toBe(names.length);
    const required = checkoutConfig.addressFields
      .filter((field) => field.required)
      .map((f) => f.name);
    expect(required).toEqual(["city", "line1"]);
  });
});
