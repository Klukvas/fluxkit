import { describe, expect, it } from "vitest";
import {
  buildSearchDocuments,
  buildSearchFilterDocuments,
  deriveFacetSpecs,
  hasVariantLevelSelection,
  matchesSearchSelection,
} from "./index.js";
import type {
  SearchBuildContext,
  SearchFilterDocument,
  SearchProductFacts,
  SearchSelection,
  SearchVariantFacts,
} from "./index.js";
import { assignment, attribute, selectAttribute } from "./test-support.js";

const context: SearchBuildContext = {
  locale: "en",
  defaultLocale: "uk",
  options: [
    { code: "color", label: { uk: "Колір" }, values: [{ code: "red", label: { uk: "червоний" } }] },
    { code: "size", label: { uk: "Розмір" }, values: [{ code: "l", label: { uk: "L" } }] },
  ],
  attributes: [
    assignment(selectAttribute("material", ["cotton", "wool"], { isFilterable: true })),
    assignment(
      attribute("tags", "multiselect", {
        isFilterable: true,
        options: [
          { code: "a", label: { uk: "a" } },
          { code: "b", label: { uk: "b" } },
        ],
      }),
    ),
    assignment(attribute("waterproof", "boolean", { isFilterable: true }), "variant"),
    assignment(attribute("weight", "number", { isFilterable: true }), "variant"),
    assignment(
      attribute("secret", "boolean", {
        isFilterable: true,
        isInternal: true,
        isVisibleOnStorefront: false,
      }),
      "variant",
    ),
  ],
};

function variant(id: string, overrides: Partial<SearchVariantFacts> = {}): SearchVariantFacts {
  return {
    id,
    sku: `SKU-${id}`,
    isActive: true,
    shopPrice: 599,
    availability: "in_stock",
    optionValues: [
      { optionCode: "color", valueCode: "red" },
      { optionCode: "size", valueCode: "l" },
    ],
    attributes: { waterproof: true, weight: 1.5, secret: true },
    ...overrides,
  };
}

function product(variants: SearchVariantFacts[]): SearchProductFacts {
  return {
    id: "p1",
    slug: "shirt",
    status: "active",
    publishedAt: "2026-11-01T10:00:00.000Z",
    title: { uk: "Сорочка", en: "Shirt" },
    description: null,
    brand: { slug: "nordic", name: { uk: "Нордік" } },
    categories: [{ id: "c-leaf", name: { uk: "Сорочки" }, ancestorIds: ["c-root"] }],
    attributes: { material: "cotton", tags: ["b", "a"] },
    variants,
  };
}

const [doc] = buildSearchFilterDocuments(product([variant("v1")]), context);
if (doc === undefined) {
  throw new Error("Test setup: the builder returned no document");
}
const documentOf = (overrides: Partial<SearchVariantFacts>): SearchFilterDocument => {
  const [built] = buildSearchFilterDocuments(product([variant("v9", overrides)]), context);
  if (built === undefined) throw new Error("Test setup: no document");
  return built;
};

describe("buildSearchFilterDocuments", () => {
  it("holds exactly the filter fields buildSearchDocuments writes into the index, for every sellable variant", () => {
    const facts = product([
      variant("v1"),
      variant("v2", { shopPrice: 629, availability: "out_of_stock" }),
      variant("v3", { shopPrice: null }),
      variant("v4", { isActive: false }),
    ]);
    const full = buildSearchDocuments(facts, context);
    const filter = buildSearchFilterDocuments(facts, context);
    expect(filter.map((entry) => entry.id)).toEqual(["v1", "v2"]);
    expect(filter).toEqual(
      full.map((entry) => {
        const picked: Record<string, unknown> = { id: entry.id, productId: entry.productId };
        for (const [key, value] of Object.entries(entry)) {
          if (
            ["brand", "categories", "price", "inStock"].includes(key) ||
            key.startsWith("opt_") ||
            key.startsWith("attr_")
          ) {
            picked[key] = value;
          }
        }
        return picked;
      }),
    );
  });

  it("never carries an internal attribute, a SKU or a text field", () => {
    expect(doc).not.toHaveProperty("attr_secret");
    expect(JSON.stringify(doc)).not.toContain("SKU-");
    expect(doc).not.toHaveProperty("title");
    expect(doc).toMatchObject({ opt_color: "red", attr_tags: ["a", "b"], inStock: true });
  });

  it("has no document for a product that is not active", () => {
    expect(
      buildSearchFilterDocuments({ ...product([variant("v1")]), status: "draft" }, context),
    ).toEqual([]);
  });
});

describe("matchesSearchSelection (the engine's filter semantics, ADR 0034)", () => {
  const cases: [string, SearchSelection, boolean][] = [
    ["the empty selection", {}, true],
    ["brand in the list", { brands: ["other", "nordic"] }, true],
    ["brand not in the list", { brands: ["other"] }, false],
    ["a category or an ancestor", { categories: ["c-root"] }, true],
    ["an unrelated category", { categories: ["c-x"] }, false],
    ["inStock true on an in-stock variant", { inStock: true }, true],
    ["inStock false on an in-stock variant", { inStock: false }, false],
    ["one option value", { options: { color: ["red"] } }, true],
    ["values of one option are OR", { options: { color: ["blue", "red"] } }, true],
    ["another value", { options: { color: ["blue"] } }, false],
    ["options are AND", { options: { color: ["red"], size: ["m"] } }, false],
    ["an option the variant lacks", { options: { finish: ["matte"] } }, false],
    [
      "select attribute",
      { attributes: { material: { kind: "values", values: ["cotton"] } } },
      true,
    ],
    ["select other", { attributes: { material: { kind: "values", values: ["wool"] } } }, false],
    ["multiselect any", { attributes: { tags: { kind: "values", values: ["b", "z"] } } }, true],
    ["multiselect none", { attributes: { tags: { kind: "values", values: ["z"] } } }, false],
    ["boolean equal", { attributes: { waterproof: { kind: "boolean", value: true } } }, true],
    ["boolean other", { attributes: { waterproof: { kind: "boolean", value: false } } }, false],
    ["number in range", { attributes: { weight: { kind: "range", min: 1, max: 2 } } }, true],
    ["number at the ends", { attributes: { weight: { kind: "range", min: 1.5, max: 1.5 } } }, true],
    ["number above", { attributes: { weight: { kind: "range", max: 1 } } }, false],
    ["number below", { attributes: { weight: { kind: "range", min: 2 } } }, false],
    [
      "an attribute not on the document",
      { attributes: { secret: { kind: "boolean", value: true } } },
      false,
    ],
    ["price in range", { price: { min: 599, max: 599 } }, true],
    ["price open low end", { price: { max: 600 } }, true],
    ["price above", { price: { min: 600 } }, false],
    [
      "everything together",
      {
        brands: ["nordic"],
        categories: ["c-leaf"],
        inStock: true,
        options: { color: ["red"], size: ["l"] },
        attributes: { material: { kind: "values", values: ["cotton"] } },
        price: { min: 500, max: 700 },
      },
      true,
    ],
  ];
  it.each(cases)("%s", (_name, selection, expected) => {
    expect(matchesSearchSelection(doc, selection)).toBe(expected);
  });

  it("matches inStock false on an out-of-stock variant and never on a low-stock one", () => {
    expect(
      matchesSearchSelection(documentOf({ availability: "out_of_stock" }), { inStock: false }),
    ).toBe(true);
    expect(
      matchesSearchSelection(documentOf({ availability: "low_stock" }), { inStock: false }),
    ).toBe(false);
    expect(
      matchesSearchSelection(documentOf({ availability: "low_stock" }), { inStock: true }),
    ).toBe(true);
  });

  it("does not match a variant whose value does not fit its definition (left out of the document)", () => {
    expect(
      matchesSearchSelection(documentOf({ attributes: { weight: "heavy" } }), {
        attributes: { weight: { kind: "range", min: 0 } },
      }),
    ).toBe(false);
  });
});

describe("hasVariantLevelSelection", () => {
  const specs = deriveFacetSpecs({
    options: [{ code: "color" }],
    attributes: context.attributes,
  });
  it.each<[string, SearchSelection, boolean]>([
    ["nothing", {}, false],
    ["brand and category", { brands: ["nordic"], categories: ["c-leaf"] }, false],
    [
      "a product-level attribute",
      { attributes: { material: { kind: "values", values: ["cotton"] } } },
      false,
    ],
    ["inStock", { inStock: false }, true],
    ["an option", { options: { color: ["red"] } }, true],
    ["an empty option list", { options: { color: [] } }, false],
    ["a price", { price: { min: 1 } }, true],
    ["a variant-level attribute", { attributes: { weight: { kind: "range", min: 1 } } }, true],
    [
      "an attribute without a facet",
      { attributes: { unknown: { kind: "boolean", value: true } } },
      true,
    ],
  ])("%s", (_name, selection, expected) => {
    expect(hasVariantLevelSelection(selection, specs)).toBe(expected);
  });
});
