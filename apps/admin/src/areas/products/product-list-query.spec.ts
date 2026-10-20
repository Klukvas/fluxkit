import { describe, expect, it } from "vitest";
import {
  PRODUCT_LIST_LIMIT,
  SEARCH_MAX_LENGTH,
  SEARCH_PATTERN,
  SEARCH_PATTERN_SOURCE,
  checkSearchText,
  listRequest,
  readProductListQuery,
  withFilter,
  writeProductListQuery,
  type ProductListQuery,
} from "./product-list-query";

const BRAND = "0d9f3a52-55c1-4f1e-9a43-6a6c1b2d7e10";
const CATEGORY = "5b0c7a1e-2f4d-4e6a-8b9c-0a1b2c3d4e5f";

const read = (search: string) => readProductListQuery(new URLSearchParams(search));

describe("product list query (filters and paging in the URL)", () => {
  it("reads an empty query as the unfiltered first page", () => {
    expect(read("")).toEqual({ q: "", limit: PRODUCT_LIST_LIMIT, offset: 0 });
  });

  it("reads every filter", () => {
    expect(
      read(`status=draft&brandId=${BRAND}&categoryId=${CATEGORY}&q=futbolka&offset=50&limit=20`),
    ).toEqual({
      status: "draft",
      brandId: BRAND,
      categoryId: CATEGORY,
      q: "futbolka",
      limit: 20,
      offset: 50,
    });
  });

  it("ignores a hand-edited bad value instead of failing (the API validates anyway)", () => {
    expect(read("status=deleted&brandId=nope&categoryId=1&q=a%20b&offset=-1&limit=500")).toEqual({
      q: "",
      limit: PRODUCT_LIST_LIMIT,
      offset: 0,
    });
    expect(read(`q=${"a".repeat(SEARCH_MAX_LENGTH + 1)}`).q).toBe("");
    expect(read("q=%20%20sku-1%20").q).toBe("sku-1");
  });

  it("writes the bare path for the unfiltered first page and keeps the filters in a stable order", () => {
    expect(writeProductListQuery({ q: "", limit: PRODUCT_LIST_LIMIT, offset: 0 })).toBe("");
    const query: ProductListQuery = {
      status: "active",
      brandId: BRAND,
      categoryId: CATEGORY,
      q: "SKU.1",
      limit: PRODUCT_LIST_LIMIT,
      offset: 100,
    };
    const written = writeProductListQuery(query);
    expect(written).toBe(
      `?status=active&brandId=${BRAND}&categoryId=${CATEGORY}&q=SKU.1&offset=100`,
    );
    expect(read(written.slice(1))).toEqual(query);
  });

  it("goes back to the first page when a filter changes, and keeps the others", () => {
    const query = read(`status=draft&brandId=${BRAND}&offset=150`);
    expect(withFilter(query, { q: "abc" })).toEqual({
      status: "draft",
      brandId: BRAND,
      q: "abc",
      limit: PRODUCT_LIST_LIMIT,
      offset: 0,
    });
    expect(withFilter(query, { status: undefined })).toEqual({
      brandId: BRAND,
      q: "",
      limit: PRODUCT_LIST_LIMIT,
      offset: 0,
    });
  });

  it("asks the API only for the filters that are set", () => {
    expect(listRequest(read(""))).toEqual({ limit: PRODUCT_LIST_LIMIT, offset: 0 });
    expect(listRequest(read(`q=abc&categoryId=${CATEGORY}&offset=50`))).toEqual({
      q: "abc",
      categoryId: CATEGORY,
      limit: PRODUCT_LIST_LIMIT,
      offset: 50,
    });
  });
});

describe("search text (a slug prefix or an exact SKU)", () => {
  it("accepts letters, digits, dots, underscores and hyphens up to 160 characters, trimmed", () => {
    expect(checkSearchText("  Futbolka-basic_1.2 ")).toEqual({
      ok: true,
      value: "Futbolka-basic_1.2",
    });
    expect(checkSearchText("")).toEqual({ ok: true, value: "" });
    expect(checkSearchText("   ")).toEqual({ ok: true, value: "" });
    expect(checkSearchText("a".repeat(SEARCH_MAX_LENGTH))).toEqual({
      ok: true,
      value: "a".repeat(SEARCH_MAX_LENGTH),
    });
  });

  it("refuses what the API refuses, with the reason the form explains", () => {
    expect(checkSearchText("a".repeat(SEARCH_MAX_LENGTH + 1))).toEqual({
      ok: false,
      reason: "too_long",
    });
    for (const text of ["two words", "100%", "a/b", "ґудзик", "x,y", "a*"]) {
      expect(checkSearchText(text), text).toEqual({ ok: false, reason: "invalid_characters" });
    }
  });

  it("has a native pattern that means the same as the check", () => {
    const native = new RegExp(`^(?:${SEARCH_PATTERN_SOURCE})$`, "v");
    for (const sample of ["abc", "A.B_C-1", "-", "a b", "a/b", "ü", "", "a%"]) {
      expect(native.test(sample), sample).toBe(SEARCH_PATTERN.test(sample));
    }
  });
});
