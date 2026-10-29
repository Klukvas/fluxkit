import type { SearchFacet, SearchFacetValue } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import { sentinelTranslator } from "../components/test-helpers";
import {
  describeFormFailure,
  facetTitle,
  facetValueLabel,
  priceBoxHints,
  selectedFilters,
  sortChoices,
} from "./search-facets";
import type { SearchQuery } from "./search-query";

const t = sentinelTranslator();

function facet(overrides: Partial<SearchFacet>): SearchFacet {
  return {
    key: "brand",
    kind: "slug",
    level: "product",
    label: null,
    counted: true,
    values: [],
    range: null,
    ...overrides,
  };
}

function value(overrides: Partial<SearchFacetValue>): SearchFacetValue {
  return { code: "acme", label: "Acme", count: 3, selected: false, ...overrides };
}

const empty: SearchQuery = { q: "", facets: [], price: null, sort: null, page: 1 };

describe("facetTitle", () => {
  it("uses the API's name for an option or attribute, and the shop's words for brand, category and availability", () => {
    expect(facetTitle(t, facet({ key: "opt.size", label: "Size" }))).toBe("Size");
    expect(facetTitle(t, facet({ key: "brand" }))).toBe("§search.facet.brand");
    expect(facetTitle(t, facet({ key: "category" }))).toBe("§search.facet.category");
    expect(facetTitle(t, facet({ key: "inStock" }))).toBe("§search.facet.inStock");
  });

  it("falls back to the key for a facet with neither a name nor a known key, never to nothing", () => {
    expect(facetTitle(t, facet({ key: "attr.weird", label: null }))).toBe("attr.weird");
  });
});

describe("facetValueLabel", () => {
  it("shows the API's label", () => {
    expect(facetValueLabel(t, facet({}), value({ label: "Acme Co" }))).toBe("Acme Co");
  });

  it("words true and false itself: in stock, out of stock, yes and no", () => {
    const stock = facet({ key: "inStock", kind: "boolean", level: "variant" });
    expect(facetValueLabel(t, stock, value({ code: "true", label: null }))).toBe(
      "§search.facet.inStock.true",
    );
    expect(facetValueLabel(t, stock, value({ code: "false", label: null }))).toBe(
      "§search.facet.inStock.false",
    );
    const flag = facet({ key: "attr.waterproof", kind: "boolean" });
    expect(facetValueLabel(t, flag, value({ code: "true", label: null }))).toBe(
      "§search.facet.true",
    );
    expect(facetValueLabel(t, flag, value({ code: "false", label: null }))).toBe(
      "§search.facet.false",
    );
  });

  it("shows the code when the API gave no label for anything else", () => {
    expect(facetValueLabel(t, facet({ kind: "code" }), value({ code: "m", label: null }))).toBe(
      "m",
    );
  });
});

describe("sortChoices", () => {
  it("offers relevance only with words, and marks the one in force (the API's default when none is chosen)", () => {
    expect(sortChoices({ ...empty, q: "x" })).toEqual({
      options: ["relevance", "newest", "price_asc", "price_desc"],
      selected: "relevance",
    });
    expect(sortChoices(empty)).toEqual({
      options: ["newest", "price_asc", "price_desc"],
      selected: "newest",
    });
    expect(sortChoices({ ...empty, q: "x", sort: "price_desc" }).selected).toBe("price_desc");
  });
});

describe("selectedFilters", () => {
  const facets = [
    facet({
      key: "brand",
      values: [
        value({ code: "acme", label: "Acme", selected: true }),
        value({ code: "zeta", label: "Zeta" }),
      ],
    }),
    facet({
      key: "inStock",
      kind: "boolean",
      level: "variant",
      counted: false,
      values: [value({ code: "true", label: null, count: null, selected: true })],
    }),
    facet({ key: "attr.length", kind: "range", label: "Length", range: { min: 1, max: 9 } }),
  ];

  it("lists every chosen value, a chosen range and the price, each with the address that removes it", () => {
    const query: SearchQuery = {
      q: "lamp",
      facets: ["brand:acme", "inStock:true", "attr.length:2..5"],
      price: { min: 1000, max: null },
      sort: "newest",
      page: 3,
    };
    const filters = selectedFilters({ query, facets, t, currency: "UAH", exponent: 2 });
    expect(filters.map((filter) => filter.label)).toEqual([
      "§search.facet.brand: Acme",
      "§search.facet.inStock: §search.facet.inStock.true",
      "Length: 2–5",
      "§search.facet.price: §search.facet.min 10",
    ]);
    expect(filters.map((filter) => filter.remove)).toEqual([
      { ...query, facets: ["inStock:true", "attr.length:2..5"], page: 1 },
      { ...query, facets: ["brand:acme", "attr.length:2..5"], page: 1 },
      { ...query, facets: ["brand:acme", "inStock:true"], page: 1 },
      { ...query, price: null, page: 1 },
    ]);
  });

  const unselected = facets.map((entry) => ({
    ...entry,
    values: entry.values.map((entry2) => ({ ...entry2, selected: false })),
  }));

  it("lists nothing when nothing is chosen", () => {
    expect(
      selectedFilters({ query: empty, facets: unselected, t, currency: "UAH", exponent: 2 }),
    ).toEqual([]);
  });

  it("writes open ends of a range and of the price in words", () => {
    const filters = selectedFilters({
      query: { ...empty, facets: ["attr.length:..5"], price: { min: null, max: 250 } },
      facets: unselected,
      t,
      currency: "UAH",
      exponent: 2,
    });
    expect(filters.map((filter) => filter.label)).toEqual([
      "Length: §search.facet.max 5",
      "§search.facet.price: §search.facet.max 2.5",
    ]);
  });
});

describe("describeFormFailure", () => {
  it("names the message and the box for each way the filter form can be wrong", () => {
    expect(describeFormFailure("price_min")).toEqual({
      messageKey: "searchForm.error.priceMin",
      field: "priceMin",
    });
    expect(describeFormFailure("price_max")).toEqual({
      messageKey: "searchForm.error.priceMax",
      field: "priceMax",
    });
    expect(describeFormFailure("price_order")).toEqual({
      messageKey: "searchForm.error.priceOrder",
      field: "priceMin",
    });
    expect(describeFormFailure("range:attr.length")).toEqual({
      messageKey: "searchForm.error.range",
      field: "rmin.attr.length",
    });
  });

  it("has a general message for anything else", () => {
    expect(describeFormFailure("facet")).toEqual({
      messageKey: "searchForm.error.title",
      field: null,
    });
  });
});

describe("priceBoxHints", () => {
  it("gives the placeholders of the price boxes from the result's range", () => {
    expect(priceBoxHints({ min: 1250, max: 99000 }, 2)).toEqual({ min: "12.5", max: "990" });
    expect(priceBoxHints(null, 2)).toEqual({ min: "", max: "" });
  });
});
