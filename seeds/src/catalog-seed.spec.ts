import {
  MAX_AMOUNT,
  MAX_ON_HAND,
  isValidCode,
  isValidValueCode,
  parseSynonymTerms,
  validateCountryCodes,
  validateShippingPricing,
  validateSlug,
  type I18nText,
} from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import { catalogSeed } from "./index.js";
import type { SeedCategory } from "./types.js";

// Data-only checks: they catch a typo in a code or slug before the runner meets it. The rules themselves
// (codes, slugs, attribute values) come from core; the runner validates again through the admin services.

function expectBothLocales(text: I18nText, where: string): void {
  expect(Object.keys(text).sort(), where).toEqual(["en", "uk"]);
  for (const value of Object.values(text)) {
    expect(value.trim().length, where).toBeGreaterThan(0);
  }
}

function flatten(categories: readonly SeedCategory[]): SeedCategory[] {
  return categories.flatMap((category) => [category, ...flatten(category.children ?? [])]);
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

describe("catalog seed data", () => {
  const { attributes, options, productTypes, brands, categories, products } = catalogSeed;
  const allCategories = flatten(categories);

  it("has the promised amount of data", () => {
    expect(productTypes.map((type) => type.code)).toEqual([
      "clothing",
      "hand_tool",
      "digital_product",
    ]);
    const countOf = (type: string) =>
      products.filter((product) => product.productTypeCode === type).length;
    expect(countOf("clothing")).toBeGreaterThanOrEqual(3);
    expect(countOf("hand_tool")).toBeGreaterThanOrEqual(3);
    expect(countOf("digital_product")).toBeGreaterThanOrEqual(2);
    expect(categories.every((category) => (category.children ?? []).length > 0)).toBe(true);
  });

  it("has unique, well-formed codes and slugs", () => {
    expect(unique(attributes.map((attribute) => attribute.code))).toBe(true);
    expect(unique(options.map((option) => option.code))).toBe(true);
    expect(unique(productTypes.map((type) => type.code))).toBe(true);
    expect(unique(allCategories.map((category) => category.slug))).toBe(true);
    expect(unique(brands.map((brand) => brand.slug))).toBe(true);
    expect(unique(products.map((product) => product.slug))).toBe(true);
    for (const code of [
      ...attributes.map((attribute) => attribute.code),
      ...options.map((option) => option.code),
      ...productTypes.map((type) => type.code),
    ]) {
      expect(isValidCode(code), code).toBe(true);
    }
    for (const attribute of attributes) {
      for (const choice of attribute.options ?? []) {
        expect(isValidValueCode(choice.code), `${attribute.code}.${choice.code}`).toBe(true);
      }
    }
    for (const option of options) {
      expect(unique(option.values.map((value) => value.code))).toBe(true);
      for (const value of option.values) {
        expect(isValidValueCode(value.code), `${option.code}.${value.code}`).toBe(true);
      }
    }
    for (const slug of [
      ...allCategories.map((category) => category.slug),
      ...brands.map((brand) => brand.slug),
      ...products.map((product) => product.slug),
    ]) {
      expect(validateSlug(slug).ok, slug).toBe(true);
    }
  });

  it("has uk and en texts everywhere", () => {
    for (const attribute of attributes) {
      expectBothLocales(attribute.name, attribute.code);
      for (const choice of attribute.options ?? []) {
        expectBothLocales(choice.label, `${attribute.code}.${choice.code}`);
      }
    }
    for (const option of options) {
      expectBothLocales(option.name, option.code);
      for (const value of option.values) {
        expectBothLocales(value.label, `${option.code}.${value.code}`);
      }
    }
    for (const type of productTypes) {
      expectBothLocales(type.name, type.code);
    }
    for (const entity of [...brands, ...allCategories]) {
      expectBothLocales(entity.name, entity.slug);
    }
    for (const product of products) {
      expectBothLocales(product.title, product.slug);
      expectBothLocales(product.description, product.slug);
      for (const item of product.media) {
        expectBothLocales(item.alt, `${product.slug} ${item.file}`);
      }
    }
  });

  it("only references things that exist", () => {
    const attributeCodes = new Set(attributes.map((attribute) => attribute.code));
    const optionCodes = new Set(options.map((option) => option.code));
    const typeByCode = new Map(productTypes.map((type) => [type.code, type]));
    const categorySlugs = new Set(allCategories.map((category) => category.slug));
    const brandSlugs = new Set(brands.map((brand) => brand.slug));

    for (const type of productTypes) {
      for (const assignment of type.attributes) {
        expect(attributeCodes.has(assignment.attributeCode), assignment.attributeCode).toBe(true);
      }
      for (const code of type.optionCodes) {
        expect(optionCodes.has(code), code).toBe(true);
      }
    }
    for (const product of products) {
      const type = typeByCode.get(product.productTypeCode);
      expect(type, product.slug).toBeDefined();
      expect(brandSlugs.has(product.brandSlug), product.slug).toBe(true);
      expect(product.categorySlugs.length, product.slug).toBeGreaterThan(0);
      for (const slug of product.categorySlugs) {
        expect(categorySlugs.has(slug), `${product.slug} -> ${slug}`).toBe(true);
      }
      const assigned = new Set(type?.attributes.map((assignment) => assignment.attributeCode));
      for (const code of Object.keys(product.attributes)) {
        expect(assigned.has(code), `${product.slug} -> ${code}`).toBe(true);
      }
      // A product uses exactly the options of its type, each with values that exist.
      expect(product.options.map((option) => option.optionCode)).toEqual(type?.optionCodes);
      for (const selection of product.options) {
        const known = options.find((option) => option.code === selection.optionCode);
        const valueCodes = new Set(known?.values.map((value) => value.code));
        expect(selection.valueCodes.length, product.slug).toBeGreaterThan(0);
        for (const code of selection.valueCodes) {
          expect(valueCodes.has(code), `${product.slug} -> ${code}`).toBe(true);
        }
      }
      for (const item of product.media) {
        // A file of seeds/assets (drawn by scripts/generate-demo-images.mjs); the runner uploads it through the media service.
        expect(item.file).toMatch(/^[a-z0-9-]+\.webp$/);
        if (item.optionValue !== undefined) {
          const chosen = product.options.find(
            (selection) => selection.optionCode === item.optionValue?.optionCode,
          );
          expect(chosen?.valueCodes, `${product.slug} ${item.file}`).toContain(
            item.optionValue.valueCode,
          );
        }
      }
    }
  });

  it("covers every required attribute of the product type", () => {
    for (const product of products) {
      const type = productTypes.find((candidate) => candidate.code === product.productTypeCode);
      for (const assignment of type?.attributes ?? []) {
        if (assignment.isRequired === true) {
          expect(product.attributes, product.slug).toHaveProperty(assignment.attributeCode);
        }
      }
    }
  });

  it("keeps the leak-rule fixtures: an internal attribute and a filterable one", () => {
    expect(attributes.some((attribute) => attribute.isInternal === true)).toBe(true);
    expect(attributes.some((attribute) => attribute.isFilterable === true)).toBe(true);
  });

  describe("prices and stock", () => {
    const typeByCode = new Map(productTypes.map((type) => [type.code, type]));
    // Same as the default LOW_STOCK_THRESHOLD in @fluxkit/config.
    const lowStockThreshold = 5;

    /** Every combination of the chosen option values, as sorted `option=value` keys. */
    function combinations(product: (typeof products)[number]): string[] {
      return product.options
        .reduce<string[][]>(
          (rows, selection) =>
            rows.flatMap((row) =>
              selection.valueCodes.map((value) => [...row, `${selection.optionCode}=${value}`]),
            ),
          [[]],
        )
        .map((row) => [...row].sort().join(";"));
    }

    function keyOf(optionValues: Readonly<Record<string, string>>): string {
      return Object.entries(optionValues)
        .map(([code, value]) => `${code}=${value}`)
        .sort()
        .join(";");
    }

    it("describes exactly the variants that the options generate, each once", () => {
      for (const product of products) {
        const keys = product.variants.map((variant) => keyOf(variant.optionValues));
        expect(unique(keys), product.slug).toBe(true);
        expect([...keys].sort(), product.slug).toEqual([...combinations(product)].sort());
      }
    });

    it("has a valid price for every variant, and compare-at prices above the price", () => {
      for (const product of products) {
        for (const variant of product.variants) {
          const where = `${product.slug} ${keyOf(variant.optionValues)}`;
          expect(Number.isInteger(variant.amount), where).toBe(true);
          expect(variant.amount, where).toBeGreaterThan(0);
          expect(variant.amount, where).toBeLessThanOrEqual(MAX_AMOUNT);
          if (variant.compareAtAmount !== undefined) {
            expect(Number.isInteger(variant.compareAtAmount), where).toBe(true);
            expect(variant.compareAtAmount, where).toBeGreaterThan(variant.amount);
            expect(variant.compareAtAmount, where).toBeLessThanOrEqual(MAX_AMOUNT);
          }
        }
      }
      const withCompareAt = products.flatMap((product) =>
        product.variants.filter((variant) => variant.compareAtAmount !== undefined),
      );
      expect(withCompareAt.length).toBeGreaterThanOrEqual(2);
      const amounts = products.flatMap((product) => product.variants.map((v) => v.amount));
      expect(new Set(amounts).size).toBeGreaterThan(5);
    });

    it("gives stock only to tracked variants, as whole numbers within the limit", () => {
      for (const product of products) {
        const requiresShipping = typeByCode.get(product.productTypeCode)?.requiresShipping;
        for (const variant of product.variants) {
          const where = `${product.slug} ${keyOf(variant.optionValues)}`;
          if (requiresShipping === false) {
            // Digital goods are untracked (the product type default): no stock, no backorder.
            expect(variant.stock, where).toBeUndefined();
            expect(variant.allowBackorder, where).toBeUndefined();
          } else {
            expect(Number.isInteger(variant.stock), where).toBe(true);
            expect(variant.stock, where).toBeGreaterThanOrEqual(0);
            expect(variant.stock, where).toBeLessThanOrEqual(MAX_ON_HAND);
          }
        }
      }
    });

    it("shows every store state: in stock, low stock, out of stock and backorder", () => {
      const tracked = products.flatMap((product) =>
        product.variants.filter((variant) => variant.stock !== undefined),
      );
      const stocks = tracked.map((variant) => variant.stock ?? 0);
      expect(stocks.some((stock) => stock > lowStockThreshold)).toBe(true);
      expect(stocks.some((stock) => stock > 0 && stock <= lowStockThreshold)).toBe(true);
      expect(
        tracked.some((variant) => variant.stock === 0 && variant.allowBackorder !== true),
      ).toBe(true);
      expect(tracked.some((variant) => variant.allowBackorder === true)).toBe(true);
      expect(
        products.some(
          (product) => typeByCode.get(product.productTypeCode)?.requiresShipping === false,
        ),
      ).toBe(true);
    });
  });

  describe("demo shipping methods (review m-9)", () => {
    const { shippingMethods } = catalogSeed;

    it("has the three documented demo methods with valid codes, uk and en texts, pricing and countries", () => {
      expect(
        shippingMethods.map((method) => [method.code, method.kind, method.providerCode]),
      ).toEqual([
        ["demo_courier", "address", null],
        ["demo_pickup_point", "pickup_point", "fake"],
        ["demo_store_pickup", "store_pickup", null],
      ]);
      for (const method of shippingMethods) {
        expect(isValidCode(method.code), method.code).toBe(true);
        expectBothLocales(method.title, `${method.code}.title`);
        expectBothLocales(method.description, `${method.code}.description`);
        expect(method.title.en, method.code).toMatch(/\(demo\)$/);
        expect(validateShippingPricing(method.pricing).ok, method.code).toBe(true);
        expect(validateCountryCodes(method.countryCodes).ok, method.code).toBe(true);
      }
      expect(unique(shippingMethods.map((method) => method.code))).toBe(true);
    });

    it("names no real carrier: the only provider is the test-only fake", () => {
      expect(
        shippingMethods.flatMap((method) =>
          method.providerCode === null ? [] : [method.providerCode],
        ),
      ).toEqual(["fake"]);
    });
  });

  describe("demo synonym groups (ADR 0034 decision 8, search plan step 11)", () => {
    const groups = catalogSeed.synonymGroups;

    it("are valid groups by the admin API's own rule, already in its normalized form", () => {
      expect(groups.length).toBeGreaterThan(0);
      for (const group of groups) {
        const parsed = parseSynonymTerms(group.terms);
        expect(parsed, group.terms.join(", ")).toEqual({ ok: true, terms: [...group.terms] });
      }
    });

    it("cover both locales, the нозі exception of the Ukrainian stemmer and irregular English forms", () => {
      expect(new Set(groups.map((group) => group.locale))).toEqual(new Set(["uk", "en"]));
      const together = (locale: string, a: string, b: string): boolean =>
        groups.some(
          (group) => group.locale === locale && group.terms.includes(a) && group.terms.includes(b),
        );
      expect(together("uk", "нога", "нозі")).toBe(true);
      expect(together("uk", "викрутка", "відвертка")).toBe(true);
      expect(together("uk", "сорочка", "рубашка")).toBe(true);
      for (const [singular, plural] of [
        ["scarf", "scarves"],
        ["knife", "knives"],
        ["mouse", "mice"],
        ["man", "men"],
        ["woman", "women"],
        ["foot", "feet"],
      ]) {
        expect(together("en", singular ?? "", plural ?? ""), `${singular} ${plural}`).toBe(true);
      }
    });

    it("never share a term within a locale (the runner treats a group as existing when any of its terms is)", () => {
      for (const locale of ["uk", "en"]) {
        const terms = groups
          .filter((group) => group.locale === locale)
          .flatMap((group) => group.terms);
        expect(unique(terms), locale).toBe(true);
      }
    });
  });

  it("does not look like client data", () => {
    const text = JSON.stringify(catalogSeed);
    // No URL at all: images are local files (seeds/assets), so no host can leak into the template.
    expect(text.match(/https?:\/\/[^/"]+/g) ?? []).toEqual([]);
  });

  it("names each image file once per product, so every media entry gets its own upload", () => {
    for (const product of products) {
      const files = product.media.map((item) => item.file);
      expect(new Set(files).size, product.slug).toBe(files.length);
    }
  });
});
