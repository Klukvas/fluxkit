import { describe, expect, it } from "vitest";
import { isVariantSellable } from "../catalog/index.js";
import { SEARCH_DOCUMENT_VERSION, SEARCH_LIMITS, buildSearchDocuments } from "./index.js";
import type { SearchBuildContext, SearchProductFacts, SearchVariantFacts } from "./index.js";
import { assignment, attribute, selectAttribute } from "./test-support.js";

const INTERNAL_MARKER = "SECRET-MARKER-7f3a";
const HIDDEN_MARKER = "HIDDEN-MARKER-91bc";

const context: SearchBuildContext = {
  locale: "uk",
  defaultLocale: "uk",
  options: [
    {
      code: "size",
      label: { uk: "Розмір", en: "Size" },
      values: [
        { code: "m", label: { uk: "M", en: "M" } },
        { code: "l", label: { uk: "L", en: "L" } },
      ],
    },
    {
      code: "color",
      label: { uk: "Колір", en: "Colour" },
      values: [
        { code: "red", label: { uk: "червоний", en: "red" } },
        { code: "blue", label: { uk: "синій" } },
      ],
    },
  ],
  attributes: [
    assignment(
      selectAttribute("material", ["cotton", "wool"], { isFilterable: true, isSearchable: true }),
    ),
    assignment(attribute("notes", "text", { isLocalized: true, isSearchable: true })),
    assignment(attribute("waterproof", "boolean", { isFilterable: true })),
    assignment(
      attribute("tags", "multiselect", {
        isFilterable: true,
        isSearchable: true,
        options: [
          { code: "a", label: { uk: "перший", en: "first" } },
          { code: "b", label: { uk: "другий", en: "second" } },
        ],
      }),
    ),
    assignment(
      attribute("weight", "number", { isFilterable: true, isSearchable: true, unit: "kg" }),
      "variant",
    ),
    // inconsistent on purpose (the database CHECK forbids it): the builder must hold the line itself
    assignment(
      attribute("secret", "text", {
        isInternal: true,
        isSearchable: true,
        isFilterable: true,
        isVisibleOnStorefront: false,
      }),
    ),
    assignment(
      attribute("hidden_note", "text", {
        isSearchable: true,
        isFilterable: true,
        isVisibleOnStorefront: false,
      }),
    ),
    assignment(
      attribute("variant_secret", "text", {
        isInternal: true,
        isSearchable: true,
        isVisibleOnStorefront: false,
      }),
      "variant",
    ),
  ],
};

function variant(overrides: Partial<SearchVariantFacts> & { id: string }): SearchVariantFacts {
  return {
    sku: "SH-M-RED",
    isActive: true,
    shopPrice: 199000,
    availability: "in_stock",
    optionValues: [
      { optionCode: "size", valueCode: "m" },
      { optionCode: "color", valueCode: "red" },
    ],
    attributes: { weight: 0.4, variant_secret: INTERNAL_MARKER },
    ...overrides,
  };
}

function product(overrides: Partial<SearchProductFacts> = {}): SearchProductFacts {
  return {
    id: "p1",
    slug: "men-shirt",
    status: "active",
    publishedAt: "2026-10-29T10:00:00.000Z",
    title: { uk: "Сорочка чоловіча", en: "Men's shirt" },
    description: { uk: "Опис сорочки", en: "About the shirt" },
    brand: { slug: "nordic", name: { uk: "Нордік", en: "Nordic" } },
    categories: [
      { id: "c-leaf", name: { uk: "Сорочки", en: "Shirts" }, ancestorIds: ["c-root", "c-mid"] },
    ],
    attributes: {
      material: "cotton",
      notes: { uk: "Бавовна", en: "Cotton" },
      waterproof: false,
      tags: ["b", "a"],
      secret: INTERNAL_MARKER,
      hidden_note: HIDDEN_MARKER,
      not_defined: "ignored",
    },
    variants: [variant({ id: "v1" })],
    ...overrides,
  };
}

describe("buildSearchDocuments", () => {
  it("builds one document per sellable variant with all public fields", () => {
    const documents = buildSearchDocuments(
      product({
        variants: [
          variant({ id: "v1" }),
          variant({
            id: "v2",
            sku: "SH-L-BLUE",
            shopPrice: 249000,
            availability: "out_of_stock",
            optionValues: [
              { optionCode: "color", valueCode: "blue" },
              { optionCode: "size", valueCode: "l" },
            ],
            attributes: { weight: 0.5 },
          }),
        ],
      }),
      context,
    );
    expect(documents).toHaveLength(2);
    expect(documents[0]).toMatchObject({
      id: "v1",
      productId: "p1",
      productSlug: "men-shirt",
      title: "Сорочка чоловіча",
      brandName: "Нордік",
      sku: "SH-M-RED",
      optionLabels: ["M", "червоний"],
      categoryNames: ["Сорочки"],
      attributeText: ["cotton uk", "Бавовна", "перший", "другий", "0.4 kg"],
      description: "Опис сорочки",
      brand: "nordic",
      categories: ["c-leaf", "c-mid", "c-root"],
      price: 199000,
      inStock: true,
      publishedAt: Math.floor(Date.parse("2026-10-29T10:00:00.000Z") / 1000),
      opt_size: "m",
      opt_color: "red",
      attr_material: "cotton",
      attr_waterproof: false,
      attr_tags: ["a", "b"],
      attr_weight: 0.4,
    });
    expect(documents[1]).toMatchObject({
      id: "v2",
      sku: "SH-L-BLUE",
      optionLabels: ["L", "синій"],
      price: 249000,
      inStock: false,
      opt_size: "l",
      opt_color: "blue",
      attr_weight: 0.5,
    });
  });

  it("builds no document for a product that is not active", () => {
    expect(buildSearchDocuments(product({ status: "draft" }), context)).toEqual([]);
    expect(buildSearchDocuments(product({ status: "archived" }), context)).toEqual([]);
  });

  it("agrees with isVariantSellable for every combination of product status, variant state and price", () => {
    for (const status of ["draft", "active", "archived"] as const) {
      for (const isActive of [true, false]) {
        for (const shopPrice of [null, 100]) {
          const documents = buildSearchDocuments(
            product({ status, variants: [variant({ id: "v", isActive, shopPrice })] }),
            context,
          );
          const sellable = isVariantSellable({
            productStatus: status,
            variantIsActive: isActive,
            hasShopPrice: shopPrice !== null,
          });
          expect(documents.length, `${status} ${isActive} ${shopPrice}`).toBe(sellable ? 1 : 0);
        }
      }
    }
  });

  it("marks a low stock variant as in stock and a sold out one as not", () => {
    const [low, out] = buildSearchDocuments(
      product({
        variants: [
          variant({ id: "v1", availability: "low_stock" }),
          variant({ id: "v2", availability: "out_of_stock" }),
        ],
      }),
      context,
    );
    expect(low?.inStock).toBe(true);
    expect(out?.inStock).toBe(false);
  });

  it("never lets an internal or hidden attribute reach a document (marker scan)", () => {
    const documents = buildSearchDocuments(product(), context);
    const json = JSON.stringify(documents);
    expect(json).not.toContain(INTERNAL_MARKER);
    expect(json).not.toContain(HIDDEN_MARKER);
    expect(json).not.toContain("secret");
    expect(json).not.toContain("hidden_note");
    expect(json).not.toContain("not_defined");
    expect(json).not.toContain("ignored");
  });

  it("only uses the allowed field names", () => {
    const allowed = new Set([
      "id",
      "productId",
      "productSlug",
      "title",
      "brandName",
      "sku",
      "optionLabels",
      "categoryNames",
      "attributeText",
      "description",
      "stems",
      "stems5",
      "brand",
      "categories",
      "price",
      "inStock",
      "publishedAt",
    ]);
    for (const document of buildSearchDocuments(product(), context)) {
      for (const key of Object.keys(document)) {
        expect(allowed.has(key) || /^opt_[a-z]/.test(key) || /^attr_[a-z]/.test(key), key).toBe(
          true,
        );
      }
    }
  });

  it("resolves texts with the catalog fallback: requested locale, then the default locale", () => {
    const [document] = buildSearchDocuments(
      product({ title: { uk: "Лише українською" }, description: { uk: "Опис" } }),
      { ...context, locale: "en", defaultLocale: "uk" },
    );
    expect(document?.title).toBe("Лише українською");
    expect(document?.description).toBe("Опис");
    expect(document?.brandName).toBe("Nordic");
    expect(document?.categoryNames).toEqual(["Shirts"]);
    expect(document?.optionLabels).toEqual(["M", "red"]);
    // a label that exists only in the default locale falls back to it
    const [blue] = buildSearchDocuments(
      product({
        variants: [
          variant({ id: "v", optionValues: [{ optionCode: "color", valueCode: "blue" }] }),
        ],
      }),
      { ...context, locale: "en", defaultLocale: "uk" },
    );
    expect(blue?.optionLabels).toEqual(["синій"]);
  });

  it("cuts the description to 2 000 characters without breaking a character", () => {
    const [document] = buildSearchDocuments(
      product({ description: { uk: "😀".repeat(2500) } }),
      context,
    );
    expect([...(document?.description ?? "")]).toHaveLength(SEARCH_LIMITS.maxDescriptionLength);
    expect(document?.description).toBe("😀".repeat(SEARCH_LIMITS.maxDescriptionLength));
  });

  it("leaves out fields of a product without brand, description or published date", () => {
    const [document] = buildSearchDocuments(
      product({ brand: null, description: null, publishedAt: null, categories: [] }),
      context,
    );
    expect(document).not.toHaveProperty("brand");
    expect(document).not.toHaveProperty("brandName");
    expect(document).not.toHaveProperty("description");
    expect(document?.publishedAt).toBe(0);
    expect(document?.categories).toEqual([]);
    expect(document?.categoryNames).toEqual([]);
  });

  it("ignores stored attribute values that do not fit their definition", () => {
    const [document] = buildSearchDocuments(
      product({
        attributes: {
          material: "silk",
          notes: 42,
          waterproof: "yes",
          tags: "a",
          weight: "heavy",
        },
        variants: [variant({ id: "v1", attributes: { weight: "heavy" } })],
      }),
      context,
    );
    expect(document).not.toHaveProperty("attr_material");
    expect(document).not.toHaveProperty("attr_waterproof");
    expect(document).not.toHaveProperty("attr_tags");
    expect(document).not.toHaveProperty("attr_weight");
    expect(document?.attributeText).toEqual([]);
  });

  it("puts Ukrainian stems and 5-letter prefixes of the searchable texts on a Ukrainian document", () => {
    const [document] = buildSearchDocuments(
      product({
        title: { uk: "Сорочка чоловіча Basic" },
        brand: null,
        categories: [],
        attributes: {},
        variants: [variant({ id: "v1", optionValues: [], attributes: {} })],
      }),
      context,
    );
    expect(document?.stems).toEqual(["сор", "чоловіч", "basic"]);
    expect(document?.stems5).toEqual(["сороч", "чолов", "basic"]);
  });

  it("puts English stems and no prefixes on an English document, and nothing for other locales", () => {
    const base = product({
      title: { uk: "Running shoes", en: "Running shoes" },
      brand: null,
      categories: [],
      attributes: {},
      variants: [variant({ id: "v1", optionValues: [], attributes: {} })],
    });
    const [english] = buildSearchDocuments(base, { ...context, locale: "en" });
    expect(english?.stems).toEqual(["run", "shoe"]);
    expect(english?.stems5).toEqual([]);
    const [german] = buildSearchDocuments(base, { ...context, locale: "de" });
    expect(german?.stems).toEqual([]);
    expect(german?.stems5).toEqual([]);
  });

  it("is deterministic and independent of the order of the stored facts", () => {
    const first = buildSearchDocuments(product(), context);
    const second = buildSearchDocuments(
      product({
        categories: [{ id: "c-leaf", name: { uk: "Сорочки" }, ancestorIds: ["c-mid", "c-root"] }],
        attributes: { ...product().attributes, tags: ["a", "b"] },
      }),
      context,
    );
    expect(second[0]?.categories).toEqual(first[0]?.categories);
    expect(second[0]?.attr_tags).toEqual(first[0]?.attr_tags);
    expect(buildSearchDocuments(product(), context)).toEqual(first);
  });

  it("exports the document version that triggers a rebuild when it changes", () => {
    expect(SEARCH_DOCUMENT_VERSION).toBe(1);
  });
});
