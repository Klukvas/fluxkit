import { describe, expect, it } from "vitest";
import { SEARCH_SORTS, engineSort, parseSearchSort } from "./index.js";

describe("parseSearchSort", () => {
  it("defaults to relevance with a query and to newest without one", () => {
    expect(parseSearchSort(undefined, true)).toBe("relevance");
    expect(parseSearchSort(undefined, false)).toBe("newest");
    expect(parseSearchSort("", true)).toBe("relevance");
  });

  it("accepts exactly the four public sort names", () => {
    expect([...SEARCH_SORTS]).toEqual(["relevance", "newest", "price_asc", "price_desc"]);
    for (const sort of SEARCH_SORTS) {
      expect(parseSearchSort(sort, true)).toBe(sort);
    }
  });

  it("refuses anything else, including engine syntax", () => {
    for (const bad of [
      "price",
      "price:asc",
      "Newest",
      "title_asc",
      "publishedAt:desc",
      "price_asc,newest",
    ]) {
      expect(parseSearchSort(bad, true), bad).toBeNull();
    }
  });

  it("relevance without a query is the same as newest", () => {
    expect(parseSearchSort("relevance", false)).toBe("newest");
  });
});

describe("engineSort", () => {
  it("maps the public names to engine sort rules", () => {
    expect(engineSort("relevance")).toBeUndefined();
    expect(engineSort("newest")).toEqual(["publishedAt:desc", "productId:desc"]);
    expect(engineSort("price_asc")).toEqual(["price:asc"]);
    expect(engineSort("price_desc")).toEqual(["price:desc"]);
  });

  it("breaks a tie of newest by the product id, like the SQL listing's `published_at desc, id desc` (review F2)", () => {
    expect(engineSort("newest", ["price", "publishedAt", "productId"])).toEqual([
      "publishedAt:desc",
      "productId:desc",
    ]);
  });

  it("leaves the tie-break out while the live index cannot sort by the product id (an index of document version 1)", () => {
    expect(engineSort("newest", ["price", "publishedAt"])).toEqual(["publishedAt:desc"]);
    expect(engineSort("price_asc", ["price", "publishedAt"])).toEqual(["price:asc"]);
  });
});
