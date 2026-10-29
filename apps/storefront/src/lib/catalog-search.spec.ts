import { describe, expect, it } from "vitest";
import {
  catalogSearchRequest,
  fallbackCatalogQuery,
  isCacheableCatalogSearch,
  resolveCatalogAddress,
} from "./catalog-search";
import { searchPath, type SearchQuery } from "./search-query";

const empty: SearchQuery = { q: "", facets: [], price: null, sort: null, page: 1 };

function query(
  raw: Record<string, string | string[] | undefined>,
  categoryPage = false,
): { query: SearchQuery; canonical: boolean } {
  const address = resolveCatalogAddress(raw, 2, { categoryPage });
  if (address.kind !== "query") throw new Error(`expected a query, got ${address.kind}`);
  return { query: address.query, canonical: address.canonical };
}

describe("catalog page address with search on (the /search URL state without words)", () => {
  it("reads the same f, price, sort and page parameters as the results page", () => {
    const { query: read, canonical } = query({
      f: ["opt.size:m", "brand:demo-brand"],
      price: "100..5000",
      sort: "price_asc",
      page: "2",
    });
    expect(read).toEqual({
      q: "",
      facets: ["opt.size:m", "brand:demo-brand"],
      price: { min: 100, max: 5000 },
      sort: "price_asc",
      page: 2,
    });
    expect(canonical).toBe(true);
    expect(searchPath(read, "/catalog")).toBe(
      "/catalog?f=opt.size%3Am&f=brand%3Ademo-brand&price=100..5000&sort=price_asc&page=2",
    );
  });

  it("is the plain list without parameters, and page 2 alone like the SQL listing's address", () => {
    expect(query({})).toEqual({ query: empty, canonical: true });
    expect(query({ page: "2" })).toEqual({ query: { ...empty, page: 2 }, canonical: true });
  });

  it("keeps ?brand=<slug> (product pages and shared links) as an alias of f=brand:<slug>, without a redirect", () => {
    expect(query({ brand: "demo-brand" })).toEqual({
      query: { ...empty, facets: ["brand:demo-brand"] },
      canonical: true,
    });
    // Both at once select the brand once.
    expect(query({ brand: "demo-brand", f: "brand:demo-brand" }).query.facets).toEqual([
      "brand:demo-brand",
    ]);
    // An empty brand is no filter, as on the SQL listing.
    expect(query({ brand: "" })).toEqual({ query: empty, canonical: true });
  });

  it("refuses a brand alias that is not a slug (a 404, as on the SQL listing)", () => {
    expect(resolveCatalogAddress({ brand: "Not A Slug" }, 2, { categoryPage: false })).toEqual({
      kind: "malformed",
    });
  });

  it("refuses words: a catalog page is a list, words belong to /search", () => {
    expect(resolveCatalogAddress({ q: "shirt" }, 2, { categoryPage: false })).toEqual({
      kind: "malformed",
    });
  });

  it("redirects an empty q and other non-canonical forms to the short address", () => {
    expect(query({ q: "" }).canonical).toBe(false);
    expect(query({ page: "1" }).canonical).toBe(false);
    expect(query({ sort: "newest" }).canonical).toBe(false);
  });

  it("refuses a category facet on a category page (the path is the category; a second one would widen the list)", () => {
    expect(
      resolveCatalogAddress({ f: "category:7d5b4c1e-1111-4222-8333-944455556666" }, 2, {
        categoryPage: true,
      }),
    ).toEqual({ kind: "malformed" });
    // On the whole catalog the category is an ordinary facet.
    expect(query({ f: "category:7d5b4c1e-1111-4222-8333-944455556666" }).query.facets).toEqual([
      "category:7d5b4c1e-1111-4222-8333-944455556666",
    ]);
  });

  it("refuses what the results page refuses: a malformed facet, page or price", () => {
    for (const raw of [{ f: "nocolon" }, { page: "418" }, { page: "0" }, { price: "9..1" }]) {
      expect(resolveCatalogAddress(raw, 2, { categoryPage: false })).toEqual({
        kind: "malformed",
      });
    }
  });

  it("turns a script-less filter submit into the canonical address, and names a refused box", () => {
    expect(query({ priceMin: "1.50", priceMax: "", sort: "" })).toEqual({
      query: { ...empty, price: { min: 150, max: null } },
      canonical: false,
    });
    expect(
      resolveCatalogAddress({ priceMin: "20", priceMax: "10", brand: "demo-brand" }, 2, {
        categoryPage: false,
      }),
    ).toEqual({
      kind: "form_error",
      query: { ...empty, facets: ["brand:demo-brand"] },
      reason: "price_order",
    });
  });
});

describe("catalog search request", () => {
  it("adds the category of a category page as a filter on its id", () => {
    const read = { ...empty, facets: ["opt.size:m"] };
    expect(catalogSearchRequest(read, "cat-1")).toEqual({
      ...read,
      facets: ["opt.size:m", "category:cat-1"],
    });
    expect(catalogSearchRequest(read, null)).toEqual(read);
  });
});

describe("catalog search caching", () => {
  it("caches only the unfiltered list (bounded keys: category, page, sort); a facet or a price is free text", () => {
    expect(isCacheableCatalogSearch(empty)).toBe(true);
    expect(isCacheableCatalogSearch({ ...empty, page: 3, sort: "price_desc" })).toBe(true);
    expect(isCacheableCatalogSearch({ ...empty, facets: ["brand:x"] })).toBe(false);
    expect(isCacheableCatalogSearch({ ...empty, price: { min: 1, max: null } })).toBe(false);
  });
});

describe("SQL fallback of a catalog address", () => {
  it("keeps the page and one brand (the SQL listing has both) and says nothing was dropped", () => {
    expect(fallbackCatalogQuery({ ...empty, facets: ["brand:demo-brand"], page: 2 })).toEqual({
      query: { page: 2, brand: "demo-brand" },
      dropped: false,
    });
    expect(fallbackCatalogQuery(empty)).toEqual({
      query: { page: 1, brand: null },
      dropped: false,
    });
  });

  it("says what it could not apply: another facet, two brands, a price or a sort", () => {
    for (const read of [
      { ...empty, facets: ["opt.size:m"] },
      { ...empty, facets: ["brand:a", "brand:b"] },
      { ...empty, facets: ["brand:a", "inStock:true"] },
      { ...empty, price: { min: 1, max: null } },
      { ...empty, sort: "price_asc" as const },
    ]) {
      expect(fallbackCatalogQuery(read).dropped, JSON.stringify(read)).toBe(true);
    }
    expect(fallbackCatalogQuery({ ...empty, facets: ["brand:a", "brand:b"] }).query.brand).toBe(
      null,
    );
    expect(fallbackCatalogQuery({ ...empty, facets: ["brand:a", "opt.size:m"] }).query.brand).toBe(
      "a",
    );
  });
});
