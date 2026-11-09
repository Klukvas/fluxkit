import { describe, expect, it } from "vitest";
import { checkoutConfig } from "../config/checkout";
import { messagesByLocale } from "../messages";
import { footerLinks, headerLinks, sessionLinks } from "./navigation";
import { localizedHref } from "../lib/locale-path";

const { en } = messagesByLocale;

const messageKeys = new Set(Object.keys(en));

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
