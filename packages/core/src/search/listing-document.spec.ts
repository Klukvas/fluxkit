import { describe, expect, it } from "vitest";
import {
  buildSearchDocuments,
  buildSearchFilterDocuments,
  deriveIndexSettings,
  engineSort,
  SEARCH_DOCUMENT_VERSION,
  type SearchBuildContext,
  type SearchProductFacts,
} from "./index.js";

const context: SearchBuildContext = {
  locale: "en",
  defaultLocale: "uk",
  attributes: [],
  splitOptionCode: "color",
  options: [
    {
      code: "color",
      label: { uk: "Color" },
      values: [
        { code: "red", label: { uk: "Red" } },
        { code: "blue", label: { uk: "Blue" } },
      ],
    },
  ],
};
const facts: SearchProductFacts = {
  id: "product",
  slug: "product",
  status: "active",
  publishedAt: "2026-11-14T12:00:00Z",
  title: { uk: "Product" },
  description: null,
  brand: null,
  categories: [],
  attributes: {},
  optionCodes: ["color"],
  variants: ["red", "blue"].map((valueCode, index) => ({
    id: `variant${index}`,
    sku: `VARIANT${index}`,
    isActive: true,
    shopPrice: index * 100,
    availability: "out_of_stock",
    attributes: {},
    optionValues: [{ optionCode: "color", valueCode }],
  })),
};
describe("listing search documents", () => {
  it("derives stable per-value keys for all sellable documents, with the same filter-document keys", () => {
    expect(SEARCH_DOCUMENT_VERSION).toBe(5);
    const docs = buildSearchDocuments(facts, context);
    expect(docs.map((doc) => [doc.id, doc.listingKey])).toEqual([
      ["variant0", "product:color:red"],
      ["variant1", "product:color:blue"],
    ]);
    expect(buildSearchFilterDocuments(facts, context).map((doc) => doc.listingKey)).toEqual(
      docs.map((doc) => doc.listingKey),
    );
    const renamed = {
      ...context,
      options: context.options.map((option) => ({ ...option, label: { uk: "Renamed" } })),
    };
    expect(buildSearchDocuments(facts, renamed).map((doc) => doc.listingKey)).toEqual(
      docs.map((doc) => doc.listingKey),
    );
  });
  it("keeps the same option unsplit on another type and products without the chosen axis unsplit", () => {
    expect(
      buildSearchDocuments(facts, { ...context, splitOptionCode: null }).map(
        (doc) => doc.listingKey,
      ),
    ).toEqual(["product", "product"]);
    const plain = {
      ...facts,
      optionCodes: [],
      variants: facts.variants.map((variant) => ({ ...variant, optionValues: [] })),
    };
    expect(buildSearchDocuments(plain, context).map((doc) => doc.listingKey)).toEqual([
      "product",
      "product",
    ]);
  });
  it("fails visibly on corrupt coverage rather than inventing an unsplit key", () => {
    const corrupt = {
      ...facts,
      variants: facts.variants.map((variant) => ({ ...variant, optionValues: [] })),
    };
    expect(() => buildSearchDocuments(corrupt, context)).toThrow("coverage");
  });
  it("makes listingKey filterable, sortable and displayed, never searchable or an index distinct setting", () => {
    const settings = deriveIndexSettings({
      locale: "en",
      currency: "UAH",
      options: [{ code: "color" }],
      attributes: [],
      synonymGroups: [],
    }).settings;
    expect(settings.filterableAttributes).toContain("listingKey");
    expect(settings.displayedAttributes).toContain("listingKey");
    expect(settings.sortableAttributes).toContain("listingKey");
    expect(settings.searchableAttributes).not.toContain("listingKey");
    expect(settings).not.toHaveProperty("distinctAttribute");
    expect(engineSort("newest", settings.sortableAttributes, "listing")).toEqual([
      "publishedAt:desc",
      "productId:desc",
      "listingKey:asc",
    ]);
    expect(engineSort("price_asc", settings.sortableAttributes, "listing")).toEqual([
      "price:asc",
      "productId:desc",
      "listingKey:asc",
    ]);
    expect(engineSort("price_desc", settings.sortableAttributes, "listing")).toEqual([
      "price:desc",
      "productId:desc",
      "listingKey:asc",
    ]);
  });
});
