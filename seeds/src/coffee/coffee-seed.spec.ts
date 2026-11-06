import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CATALOG_LIMITS,
  MAX_AMOUNT,
  MAX_ON_HAND,
  checkBannerContent,
  checkBannerImageLocales,
  checkBannerLink,
  isValidCode,
  isValidValueCode,
  parseSynonymTerms,
  validateSku,
  validateSlug,
  type I18nText,
} from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import type { SeedCategory, SeedProduct, SeedVariantCommerce } from "../types.js";
import { coffeeCatalogSeed } from "./index.js";

// Data-only checks of the coffee demo (`pnpm seed`): they catch a typo before the runner meets it. The runner validates again
// through the admin services, and `apps/api/src/seed/seed-coffee.spec.ts` seeds it into a real database.

const ASSETS_DIR = fileURLToPath(new URL("../../assets/", import.meta.url));
const LOW_STOCK_THRESHOLD = 5;

const { attributes, options, productTypes, brands, categories, products, synonymGroups, banners } =
  coffeeCatalogSeed;

function flatten(
  nodes: readonly SeedCategory[],
  depth = 1,
): { node: SeedCategory; depth: number }[] {
  return nodes.flatMap((node) => [{ node, depth }, ...flatten(node.children ?? [], depth + 1)]);
}

const allCategories = flatten(categories);

function expectBothLocales(text: I18nText, where: string): void {
  expect(Object.keys(text).sort(), where).toEqual(["en", "uk"]);
  for (const value of Object.values(text)) {
    expect(value.trim().length, where).toBeGreaterThan(0);
  }
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function keyOf(optionValues: Readonly<Record<string, string>>): string {
  return Object.entries(optionValues)
    .map(([code, value]) => `${code}=${value}`)
    .sort()
    .join(";");
}

function combinations(product: SeedProduct): string[] {
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

const variants: { product: SeedProduct; variant: SeedVariantCommerce }[] = products.flatMap(
  (product) => product.variants.map((variant) => ({ product, variant })),
);
const typeByCode = new Map(productTypes.map((type) => [type.code, type]));

describe("coffee demo dataset", () => {
  it("is a real catalog: at least 70 products in a category tree, several brands", () => {
    expect(products.length).toBeGreaterThanOrEqual(70);
    expect(products.length).toBeLessThanOrEqual(100);
    expect(brands.length).toBeGreaterThanOrEqual(5);
    expect(new Set(products.map((product) => product.brandSlug)).size).toBe(brands.length);
    expect(allCategories.some((entry) => entry.depth === 3)).toBe(true);
    expect(Math.max(...allCategories.map((entry) => entry.depth))).toBeLessThanOrEqual(
      CATALOG_LIMITS.maxCategoryDepth,
    );
    expect(
      categories.filter((root) => (root.children ?? []).length > 0).length,
    ).toBeGreaterThanOrEqual(5);
  });

  it("has unique, well-formed codes, slugs and SKUs", () => {
    for (const code of [...attributes, ...options, ...productTypes].map((entity) => entity.code)) {
      expect(isValidCode(code), code).toBe(true);
    }
    expect(unique(attributes.map((attribute) => attribute.code))).toBe(true);
    expect(unique(options.map((option) => option.code))).toBe(true);
    expect(unique(productTypes.map((type) => type.code))).toBe(true);
    for (const attribute of attributes) {
      expect(unique((attribute.options ?? []).map((choice) => choice.code)), attribute.code).toBe(
        true,
      );
      for (const choice of attribute.options ?? [])
        expect(isValidValueCode(choice.code)).toBe(true);
    }
    for (const option of options) {
      expect(unique(option.values.map((value) => value.code)), option.code).toBe(true);
      for (const value of option.values) expect(isValidValueCode(value.code)).toBe(true);
    }
    const slugs = [
      ...products.map((product) => product.slug),
      ...brands.map((brand) => brand.slug),
      ...allCategories.map((entry) => entry.node.slug),
    ];
    for (const slug of slugs) expect(validateSlug(slug).ok, slug).toBe(true);
    expect(unique(products.map((product) => product.slug))).toBe(true);
    expect(unique(brands.map((brand) => brand.slug))).toBe(true);
    expect(unique(allCategories.map((entry) => entry.node.slug))).toBe(true);
    const skus = variants.map(({ variant }) => variant.sku ?? "");
    for (const sku of skus) {
      const checked = validateSku(sku);
      expect(checked, sku).toEqual({ ok: true, sku });
    }
    expect(unique(skus)).toBe(true);
  });

  it("has uk and en texts everywhere, and no developer marker", () => {
    for (const attribute of attributes) {
      expectBothLocales(attribute.name, attribute.code);
      for (const choice of attribute.options ?? []) expectBothLocales(choice.label, choice.code);
    }
    for (const option of options) {
      expectBothLocales(option.name, option.code);
      for (const value of option.values) expectBothLocales(value.label, value.code);
    }
    for (const entity of [
      ...productTypes,
      ...brands,
      ...allCategories.map((entry) => entry.node),
    ]) {
      expectBothLocales(entity.name, JSON.stringify(entity.name));
    }
    for (const product of products) {
      expectBothLocales(product.title, product.slug);
      expectBothLocales(product.description, product.slug);
      for (const item of product.media) expectBothLocales(item.alt, item.file);
      for (const value of Object.values(product.attributes)) {
        if (typeof value === "object" && value !== null)
          expectBothLocales(value as I18nText, product.slug);
      }
    }
    const text = JSON.stringify(coffeeCatalogSeed);
    expect(text).not.toMatch(/TODO|FIXME|lorem/i);
    // No address, link or e-mail of any real business.
    expect(text.match(/https?:\/\/|www\.|@[a-z]/gi) ?? []).toEqual([]);
  });

  it("only references things that exist, within each product type", () => {
    const attributeCodes = new Set(attributes.map((attribute) => attribute.code));
    const optionByCode = new Map(options.map((option) => [option.code, option]));
    const categorySlugs = new Set(allCategories.map((entry) => entry.node.slug));
    const brandSlugs = new Set(brands.map((brand) => brand.slug));
    for (const type of productTypes) {
      for (const assignment of type.attributes)
        expect(attributeCodes.has(assignment.attributeCode)).toBe(true);
      for (const code of type.optionCodes) expect(optionByCode.has(code), code).toBe(true);
    }
    for (const product of products) {
      const type = typeByCode.get(product.productTypeCode);
      expect(type, product.slug).toBeDefined();
      expect(brandSlugs.has(product.brandSlug), product.slug).toBe(true);
      expect(product.categorySlugs.length, product.slug).toBeGreaterThan(0);
      for (const slug of product.categorySlugs)
        expect(categorySlugs.has(slug), `${product.slug} ${slug}`).toBe(true);
      const assigned = new Set(type?.attributes.map((assignment) => assignment.attributeCode));
      for (const code of Object.keys(product.attributes))
        expect(assigned.has(code), `${product.slug} ${code}`).toBe(true);
      for (const assignment of type?.attributes ?? []) {
        if (assignment.isRequired === true)
          expect(product.attributes, product.slug).toHaveProperty(assignment.attributeCode);
      }
      // A subset of the type's options (ADR 0006: zero for a simple product), within the per-product limit.
      expect(product.options.length).toBeLessThanOrEqual(CATALOG_LIMITS.maxOptionsPerProduct);
      for (const selection of product.options) {
        expect(type?.optionCodes, product.slug).toContain(selection.optionCode);
        const known = new Set(
          optionByCode.get(selection.optionCode)?.values.map((value) => value.code),
        );
        expect(selection.valueCodes.length).toBeGreaterThan(0);
        for (const code of selection.valueCodes)
          expect(known.has(code), `${product.slug} ${code}`).toBe(true);
      }
      for (const [code, value] of Object.entries(product.attributes)) {
        const attribute = attributes.find((candidate) => candidate.code === code);
        if (attribute?.inputType === "select") {
          expect(
            attribute.options?.map((choice) => choice.code),
            `${product.slug} ${code}`,
          ).toContain(value);
        }
        if (attribute?.inputType === "number")
          expect(typeof value, `${product.slug} ${code}`).toBe("number");
      }
    }
  });

  it("keeps options and attributes apart, and no niche field names on the product (AGENTS.md 2.3)", () => {
    const attributeCodes = new Set(attributes.map((attribute) => attribute.code));
    for (const option of options) expect(attributeCodes.has(option.code), option.code).toBe(false);
    expect(attributes.some((attribute) => attribute.isInternal === true)).toBe(true);
    expect(
      attributes.filter((attribute) => attribute.isFilterable === true).length,
    ).toBeGreaterThanOrEqual(5);
  });

  it("names a committed picture for every product, each once, within the size budget", () => {
    for (const product of products) {
      expect(product.media.length, product.slug).toBeGreaterThan(0);
      const files = product.media.map((item) => item.file);
      expect(unique(files), product.slug).toBe(true);
      for (const file of files) {
        expect(file).toMatch(/^coffee\/[a-z0-9-]+\.webp$/);
        expect(existsSync(`${ASSETS_DIR}${file}`), file).toBe(true);
        expect(statSync(`${ASSETS_DIR}${file}`).size, file).toBeLessThanOrEqual(40_000);
      }
    }
  });

  describe("prices and stock", () => {
    it("describes exactly the variants that the options generate, each once", () => {
      for (const product of products) {
        const keys = product.variants.map((variant) => keyOf(variant.optionValues));
        expect(unique(keys), product.slug).toBe(true);
        expect([...keys].sort(), product.slug).toEqual([...combinations(product)].sort());
      }
    });

    it("prices every variant in positive whole minor units, compare-at above the price", () => {
      for (const { product, variant } of variants) {
        const where = `${product.slug} ${keyOf(variant.optionValues)}`;
        expect(Number.isInteger(variant.amount), where).toBe(true);
        expect(variant.amount, where).toBeGreaterThan(0);
        expect(variant.amount, where).toBeLessThanOrEqual(MAX_AMOUNT);
        if (variant.compareAtAmount !== undefined) {
          expect(Number.isInteger(variant.compareAtAmount), where).toBe(true);
          expect(variant.compareAtAmount, where).toBeGreaterThan(variant.amount);
        }
      }
      expect(
        variants.filter(({ variant }) => variant.compareAtAmount !== undefined).length,
      ).toBeGreaterThanOrEqual(3);
    });

    it("shows every store state: in stock, low stock, out of stock, backorder and untracked digital goods", () => {
      const tracked = variants.filter(
        ({ product }) => typeByCode.get(product.productTypeCode)?.requiresShipping,
      );
      for (const { product, variant } of tracked) {
        expect(Number.isInteger(variant.stock), product.slug).toBe(true);
        expect(variant.stock ?? -1).toBeGreaterThanOrEqual(0);
        expect(variant.stock ?? 0).toBeLessThanOrEqual(MAX_ON_HAND);
      }
      const stocks = tracked.map(({ variant }) => variant.stock ?? 0);
      expect(
        stocks.filter((stock) => stock > 0 && stock <= LOW_STOCK_THRESHOLD).length,
      ).toBeGreaterThanOrEqual(3);
      expect(
        tracked.filter(({ variant }) => variant.stock === 0 && variant.allowBackorder !== true)
          .length,
      ).toBeGreaterThanOrEqual(3);
      expect(tracked.some(({ variant }) => variant.allowBackorder === true)).toBe(true);
      // A whole product out of stock (every variant at 0, no backorder).
      expect(
        products.some(
          (product) =>
            typeByCode.get(product.productTypeCode)?.requiresShipping === true &&
            product.variants.every(
              (variant) => variant.stock === 0 && variant.allowBackorder !== true,
            ),
        ),
      ).toBe(true);
      const digital = variants.filter(
        ({ product }) => typeByCode.get(product.productTypeCode)?.requiresShipping === false,
      );
      expect(digital.length).toBeGreaterThan(0);
      for (const { variant } of digital) {
        expect(variant.stock).toBeUndefined();
        expect(variant.allowBackorder).toBeUndefined();
      }
    });
  });

  describe("synonym groups", () => {
    it("are valid groups in the admin API's stored form, with no term repeated within a locale", () => {
      for (const group of synonymGroups) {
        expect(parseSynonymTerms(group.terms), group.terms.join(", ")).toEqual({
          ok: true,
          terms: [...group.terms],
        });
      }
      for (const locale of ["uk", "en"]) {
        const terms = synonymGroups
          .filter((group) => group.locale === locale)
          .flatMap((group) => [...group.terms]);
        expect(terms.length, locale).toBeGreaterThan(0);
        expect(unique(terms), locale).toBe(true);
      }
    });

    it("each has a word that a product title of its locale contains", () => {
      for (const group of synonymGroups) {
        const titles = products
          .map((product) => (product.title as Record<string, string>)[group.locale] ?? "")
          .join(" ")
          .toLowerCase();
        expect(
          group.terms.some((term) => titles.includes(term)),
          `${group.locale}: ${group.terms.join(", ")}`,
        ).toBe(true);
      }
    });
  });

  describe("home banners", () => {
    it("are two cards and one picture banner with an own en picture, fixed distinct ids", () => {
      expect(banners.map((banner) => banner.layout)).toEqual(["card", "card", "image"]);
      expect(unique(banners.map((banner) => banner.id))).toBe(true);
      for (const banner of banners) {
        expect(banner.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
      }
    });

    it("pass core's banner rules, link to coffee categories that exist and name committed pictures", () => {
      const locales = { defaultLocale: "uk", locales: ["uk", "en"] };
      const categorySlugs = new Set(allCategories.map((entry) => entry.node.slug));
      for (const banner of banners) {
        expect(
          checkBannerContent(
            {
              layout: banner.layout,
              title: banner.title ?? null,
              text: banner.text ?? null,
              imageAlt: banner.imageAlt ?? null,
            },
            locales,
          ),
          banner.id,
        ).toEqual([]);
        expect(checkBannerLink(banner.link, locales.locales).ok, banner.link).toBe(true);
        expect(categorySlugs.has(banner.link.replace(/^\/c\//, "")), banner.link).toBe(true);
        expect(
          checkBannerImageLocales(
            (banner.localeImages ?? []).map((image) => image.locale),
            locales.locales,
          ),
        ).toEqual([]);
        for (const file of [
          banner.image,
          ...(banner.localeImages ?? []).map((image) => image.file),
        ]) {
          expect(file).toMatch(/^coffee\/banner-[a-z-]+\.webp$/);
          expect(existsSync(`${ASSETS_DIR}${file}`), file).toBe(true);
        }
        for (const text of [banner.title, banner.text, banner.imageAlt]) {
          if (text !== undefined) expectBothLocales(text, banner.id);
        }
      }
    });
  });
});
