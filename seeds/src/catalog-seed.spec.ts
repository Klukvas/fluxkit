import { isValidCode, isValidValueCode, validateSlug, type I18nText } from "@fluxkit/core";
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
        expectBothLocales(item.alt, `${product.slug} ${item.url}`);
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
        expect(item.url).toMatch(/^https:\/\/example\.com\/placeholder\/[a-z0-9-]+\.jpg$/);
        if (item.optionValue !== undefined) {
          const chosen = product.options.find(
            (selection) => selection.optionCode === item.optionValue?.optionCode,
          );
          expect(chosen?.valueCodes, `${product.slug} ${item.url}`).toContain(
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

  it("does not look like client data", () => {
    const text = JSON.stringify(catalogSeed);
    const hosts = text.match(/https?:\/\/[^/"]+/g) ?? [];
    expect(new Set(hosts)).toEqual(new Set(["https://example.com"]));
  });
});
