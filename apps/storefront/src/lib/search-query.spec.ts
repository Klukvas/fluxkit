import { describe, expect, it } from "vitest";
import {
  MAX_SEARCH_PAGE,
  SEARCH_PAGE_SIZE,
  clearFilters,
  facetEntry,
  isCanonicalSearch,
  isFacetSelected,
  parseSearchForm,
  parseSearchParams,
  rangeOf,
  searchPath,
  setPage,
  setPrice,
  setRange,
  setSort,
  toggleFacet,
  type SearchQuery,
} from "./search-query";

const empty: SearchQuery = { q: "", facets: [], price: null, sort: null, page: 1 };

function parsed(raw: Record<string, string | string[] | undefined>, exponent = 2): SearchQuery {
  const result = parseSearchParams(raw, exponent);
  if (!result.ok) throw new Error(`expected a query, got ${result.reason}`);
  return result.query;
}

describe("search page size", () => {
  it("asks for 24 per page and reaches page 417, the last page whose first hit lies below 10 000", () => {
    expect(SEARCH_PAGE_SIZE).toBe(24);
    expect(MAX_SEARCH_PAGE).toBe(417);
    expect((MAX_SEARCH_PAGE - 1) * SEARCH_PAGE_SIZE).toBeLessThan(10_000);
    expect(MAX_SEARCH_PAGE * SEARCH_PAGE_SIZE).toBeGreaterThanOrEqual(10_000);
  });
});

describe("parseSearchParams", () => {
  it("reads an empty address as browsing page 1", () => {
    expect(parsed({})).toEqual(empty);
  });

  it("reads q, repeated f, price, sort and page; unknown keys and repeated singles are ignored", () => {
    expect(
      parsed({
        q: ["  Screw driver ", "other"],
        f: ["brand:acme", "opt.size:m", "brand:acme"],
        price: "1000..5000",
        sort: "price_asc",
        page: "3",
        utm_source: "x",
      }),
    ).toEqual({
      q: "Screw driver",
      facets: ["brand:acme", "opt.size:m"],
      price: { min: 1000, max: 5000 },
      sort: "price_asc",
      page: 3,
    });
  });

  it("accepts a price with one open end", () => {
    expect(parsed({ price: "..5000" }).price).toEqual({ min: null, max: 5000 });
    expect(parsed({ price: "1000.." }).price).toEqual({ min: 1000, max: null });
  });

  it("keeps Ukrainian text and treats an empty q as browsing", () => {
    expect(parsed({ q: "відвертка" }).q).toBe("відвертка");
    expect(parsed({ q: "   " }).q).toBe("");
  });

  it.each([
    ["page", "0"],
    ["page", "1.5"],
    ["page", "abc"],
    ["page", "418"],
    ["page", "-1"],
    ["page", ""],
    ["sort", "cheapest"],
    ["price", "abc"],
    ["price", ".."],
    ["price", "5000..1000"],
    ["price", "1.5..2"],
    ["price", "-1..5"],
    ["price", "10"],
    ["f", "brand"],
    ["f", ":x"],
    ["f", "brand:"],
    ["f", "bra nd:x"],
    ["f", "brand:x\ny"],
    ["q", "a".repeat(201)],
    ["q", "bad\u0000text"],
    ["q", "bad\u001btext"],
  ])("refuses %s=%j (malformed is not found, never silently ignored)", (key, value) => {
    expect(parseSearchParams({ [key]: value }, 2).ok).toBe(false);
  });

  it("refuses more than 50 facet values, the API's limit, without calling it", () => {
    const many = Array.from({ length: 51 }, (_, index) => `opt.size:v${String(index)}`);
    expect(parseSearchParams({ f: many }, 2)).toEqual({ ok: false, reason: "too_many_facets" });
    expect(parseSearchParams({ f: many.slice(0, 50) }, 2).ok).toBe(true);
  });

  it("converts the form fields of a script-less submit: prices in major units, ranges, empty fields dropped", () => {
    expect(parsed({ priceMin: "10", priceMax: "50,5", q: "x", sort: "" }).price).toEqual({
      min: 1000,
      max: 5050,
    });
    expect(parsed({ priceMin: "", priceMax: "" }).price).toBeNull();
    expect(parsed({ "rmin.attr.length": "1.5", "rmax.attr.length": "20" }).facets).toEqual([
      "attr.length:1.5..20",
    ]);
    expect(parsed({ "rmin.attr.length": "-2" }).facets).toEqual(["attr.length:-2.."]);
  });

  it.each([
    { priceMin: "abc" },
    { priceMax: "1e3" },
    { priceMin: "50", priceMax: "10" },
    { "rmin.attr.length": "1e3" },
    { "rmax.attr.length": "x" },
    { "rmin.attr.length": "5", "rmax.attr.length": "1" },
  ])("refuses the form fields %j", (raw) => {
    expect(parseSearchParams(raw, 2).ok).toBe(false);
  });
});

describe("searchPath", () => {
  it("writes the shortest address: q, f, price, sort, page; defaults left out", () => {
    expect(searchPath(empty)).toBe("/search");
    expect(searchPath({ ...empty, q: "a b" })).toBe("/search?q=a%20b");
    expect(
      searchPath({
        q: "x",
        facets: ["brand:acme", "opt.size:m"],
        price: { min: 100, max: null },
        sort: "newest",
        page: 2,
      }),
    ).toBe("/search?q=x&f=brand%3Aacme&f=opt.size%3Am&price=100..&sort=newest&page=2");
  });

  it("escapes what is typed, so it can never end the address or become a second parameter", () => {
    const path = searchPath({ ...empty, q: 'a&page=9#"<script>' });
    expect(path).toBe("/search?q=a%26page%3D9%23%22%3Cscript%3E");
    expect(path).not.toMatch(/[<>"#\s]/);
  });

  it("round-trips through parseSearchParams", () => {
    const samples: SearchQuery[] = [
      empty,
      { ...empty, q: "відвертка" },
      {
        q: "a b",
        facets: ["brand:acme", "attr.length:1.5..3"],
        price: { min: 0, max: 99 },
        sort: "price_desc",
        page: 417,
      },
      { ...empty, price: { min: null, max: 7 } },
    ];
    for (const sample of samples) {
      const url = new URL(searchPath(sample), "http://x");
      const raw: Record<string, string | string[]> = {};
      for (const key of new Set(url.searchParams.keys())) {
        const all = url.searchParams.getAll(key);
        raw[key] = all.length === 1 ? (all[0] as string) : all;
      }
      expect(parsed(raw)).toEqual(sample);
    }
  });
});

describe("isCanonicalSearch", () => {
  it("is true for an address searchPath wrote and false for one the page should redirect to its short form", () => {
    expect(isCanonicalSearch({ q: "x", page: "2" }, { ...empty, q: "x", page: 2 })).toBe(true);
    expect(isCanonicalSearch({ q: "x", utm_source: "mail" }, { ...empty, q: "x" })).toBe(true);
    expect(isCanonicalSearch({ q: "x", page: "1" }, { ...empty, q: "x" })).toBe(false);
    expect(isCanonicalSearch({ q: "x", sort: "" }, { ...empty, q: "x" })).toBe(false);
    expect(
      isCanonicalSearch({ priceMin: "10" }, { ...empty, price: { min: 1000, max: null } }),
    ).toBe(false);
    expect(isCanonicalSearch({ q: " x " }, { ...empty, q: "x" })).toBe(false);
    expect(isCanonicalSearch({ f: ["b:1", "a:2"] }, { ...empty, facets: ["b:1", "a:2"] })).toBe(
      true,
    );
  });
});

describe("changing the selection", () => {
  it("toggles a facet value on and off and always returns to page 1", () => {
    const on = toggleFacet({ ...empty, page: 4 }, "brand", "acme");
    expect(on.facets).toEqual(["brand:acme"]);
    expect(on.page).toBe(1);
    expect(isFacetSelected(on, "brand", "acme")).toBe(true);
    const off = toggleFacet(on, "brand", "acme");
    expect(off.facets).toEqual([]);
    expect(isFacetSelected(off, "brand", "acme")).toBe(false);
  });

  it("keeps values of other facets and of the same facet side by side", () => {
    let query = toggleFacet(empty, "brand", "acme");
    query = toggleFacet(query, "brand", "zeta");
    query = toggleFacet(query, "opt.size", "m");
    expect(query.facets).toEqual(["brand:acme", "brand:zeta", "opt.size:m"]);
  });

  it("names an entry the way the API wants it", () => {
    expect(facetEntry("opt.size", "m")).toBe("opt.size:m");
  });

  it("sets a range for a number attribute, replacing the old one, and clears it when both ends are empty", () => {
    let query = setRange(empty, "attr.length", 1, 5);
    expect(query.facets).toEqual(["attr.length:1..5"]);
    expect(rangeOf(query, "attr.length")).toEqual({ min: "1", max: "5" });
    query = setRange(query, "attr.length", null, 9);
    expect(query.facets).toEqual(["attr.length:..9"]);
    expect(rangeOf(query, "attr.length")).toEqual({ min: "", max: "9" });
    query = setRange(query, "attr.length", null, null);
    expect(query.facets).toEqual([]);
    expect(rangeOf(query, "attr.length")).toBeNull();
  });

  it("sets and clears the price and the sort, page 1 each time", () => {
    const priced = setPrice({ ...empty, page: 3 }, { min: 100, max: 200 });
    expect(priced).toMatchObject({ price: { min: 100, max: 200 }, page: 1 });
    expect(setPrice(priced, null).price).toBeNull();
    expect(setPrice(priced, { min: null, max: null }).price).toBeNull();
    expect(setSort({ ...empty, page: 3 }, "price_desc")).toMatchObject({
      sort: "price_desc",
      page: 1,
    });
    expect(setSort({ ...empty, sort: "price_desc" }, null).sort).toBeNull();
  });

  it("clears the filters and the price but keeps the words and the sort", () => {
    const query: SearchQuery = {
      q: "x",
      facets: ["brand:acme"],
      price: { min: 1, max: 2 },
      sort: "newest",
      page: 5,
    };
    expect(clearFilters(query)).toEqual({
      q: "x",
      facets: [],
      price: null,
      sort: "newest",
      page: 1,
    });
  });

  it("moves to a page without touching anything else", () => {
    expect(setPage({ ...empty, q: "x", facets: ["brand:a"] }, 3)).toEqual({
      ...empty,
      q: "x",
      facets: ["brand:a"],
      page: 3,
    });
    expect(() => setPage(empty, 0)).toThrow(RangeError);
    expect(() => setPage(empty, MAX_SEARCH_PAGE + 1)).toThrow(RangeError);
  });
});

describe("parseSearchForm (the facet form's fields, in the browser)", () => {
  it("builds the query from the entries of a submit and goes back to page 1", () => {
    const entries: [string, string][] = [
      ["q", " lamp "],
      ["f", "brand:acme"],
      ["f", "opt.size:m"],
      ["priceMin", "10"],
      ["priceMax", ""],
      ["sort", "price_asc"],
    ];
    expect(parseSearchForm(entries, 2)).toEqual({
      ok: true,
      query: {
        q: "lamp",
        facets: ["brand:acme", "opt.size:m"],
        price: { min: 1000, max: null },
        sort: "price_asc",
        page: 1,
      },
    });
  });

  it("reports a bad price box by name, so the form can say which one", () => {
    expect(parseSearchForm([["priceMin", "abc"]], 2)).toEqual({ ok: false, reason: "price_min" });
    expect(parseSearchForm([["priceMax", "x"]], 2)).toEqual({ ok: false, reason: "price_max" });
    expect(
      parseSearchForm(
        [
          ["priceMin", "9"],
          ["priceMax", "1"],
        ],
        2,
      ),
    ).toEqual({
      ok: false,
      reason: "price_order",
    });
    expect(parseSearchForm([["rmin.attr.length", "x"]], 2)).toEqual({
      ok: false,
      reason: "range:attr.length",
    });
  });
});
