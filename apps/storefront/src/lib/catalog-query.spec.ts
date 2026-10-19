import { describe, expect, it } from "vitest";
import {
  CATALOG_PAGE_SIZE,
  MAX_API_OFFSET,
  catalogPath,
  isPageInRange,
  maxPage,
  offsetForPage,
  pageCountFor,
  parseCatalogQuery,
} from "./catalog-query";

describe("page size and the API offset cap", () => {
  it("lists 24 per page and caps the reachable page at the API's offset limit of 10 000", () => {
    expect(CATALOG_PAGE_SIZE).toBe(24);
    expect(MAX_API_OFFSET).toBe(10_000);
    // Page 417 starts at offset 9 984 (allowed); page 418 would start at 10 008 (the API answers 400).
    expect(maxPage(24)).toBe(417);
    expect(offsetForPage(417, 24)).toBe(9_984);
    expect(offsetForPage(418, 24)).toBe(10_008);
    expect(maxPage(100)).toBe(101);
  });

  it("counts pages from the total, never beyond the cap, and none for an empty list", () => {
    expect(pageCountFor(0, 24)).toBe(0);
    expect(pageCountFor(1, 24)).toBe(1);
    expect(pageCountFor(24, 24)).toBe(1);
    expect(pageCountFor(25, 24)).toBe(2);
    expect(pageCountFor(1_000_000, 24)).toBe(417);
  });

  it("accepts page 1 always (an empty list is page 1 with an empty state) and later pages only up to the last", () => {
    expect(isPageInRange(1, 0, 24)).toBe(true);
    expect(isPageInRange(2, 0, 24)).toBe(false);
    expect(isPageInRange(2, 25, 24)).toBe(true);
    expect(isPageInRange(3, 25, 24)).toBe(false);
    expect(isPageInRange(418, 1_000_000, 24)).toBe(false);
  });
});

describe("parseCatalogQuery", () => {
  it("defaults to page 1 without a brand", () => {
    expect(parseCatalogQuery({})).toEqual({ ok: true, query: { page: 1, brand: null } });
  });

  it("reads page and brand, using the first value of a repeated key and ignoring unknown keys", () => {
    expect(
      parseCatalogQuery({ page: ["3", "4"], brand: ["acme-co", "other"], utm_source: "x" }),
    ).toEqual({ ok: true, query: { page: 3, brand: "acme-co" } });
  });

  it("treats an empty brand as no brand", () => {
    expect(parseCatalogQuery({ brand: "" })).toEqual({ ok: true, query: { page: 1, brand: null } });
  });

  it.each(["0", "-1", "1.5", "abc", "", " 2", "2 ", "01", "1e3", "99999999999"])(
    "refuses the page %j (a malformed page is not found, never silently page 1)",
    (page) => {
      expect(parseCatalogQuery({ page })).toEqual({ ok: false });
    },
  );

  it.each(["Acme", "a b", "a_b", "-a", "a-", "a--b", "a/b", "a".repeat(161)])(
    "refuses the brand %j (not a slug: the API would answer 400)",
    (brand) => {
      expect(parseCatalogQuery({ brand })).toEqual({ ok: false });
    },
  );

  it("refuses a page beyond the API's offset cap without needing the API", () => {
    expect(parseCatalogQuery({ page: "417" })).toEqual({
      ok: true,
      query: { page: 417, brand: null },
    });
    expect(parseCatalogQuery({ page: "418" })).toEqual({ ok: false });
  });
});

describe("catalogPath", () => {
  it("builds the locale-less path with brand before page and omits page 1 and an empty brand", () => {
    expect(catalogPath("/catalog", {})).toBe("/catalog");
    expect(catalogPath("/catalog", { page: 1 })).toBe("/catalog");
    expect(catalogPath("/catalog", { page: 2 })).toBe("/catalog?page=2");
    expect(catalogPath("/catalog", { brand: "acme" })).toBe("/catalog?brand=acme");
    expect(catalogPath("/c/shoes", { brand: "acme", page: 3 })).toBe("/c/shoes?brand=acme&page=3");
    expect(catalogPath("/c/shoes", { brand: null, page: 1 })).toBe("/c/shoes");
  });

  it("encodes values so a query can never smuggle another parameter", () => {
    expect(catalogPath("/catalog", { brand: "a&page=9" })).toBe("/catalog?brand=a%26page%3D9");
  });

  it("refuses a page below 1 or not whole", () => {
    expect(() => catalogPath("/catalog", { page: 0 })).toThrow(RangeError);
    expect(() => catalogPath("/catalog", { page: 1.5 })).toThrow(RangeError);
  });
});
