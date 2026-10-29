import { describe, expect, it } from "vitest";
import { SEARCH_LIMITS, SearchFilterError, buildSearchFilter, quoteFilterValue } from "./index.js";
import type { SearchSelection } from "./index.js";

const CATEGORY_A = "0b1c3f5e-5d2a-4a56-8f0e-5f6a3c1d9a01";
const CATEGORY_B = "0b1c3f5e-5d2a-4a56-8f0e-5f6a3c1d9a02";

function reason(selection: SearchSelection): string {
  try {
    buildSearchFilter(selection);
  } catch (error) {
    if (error instanceof SearchFilterError) {
      return error.reason;
    }
    throw error;
  }
  throw new Error("expected a SearchFilterError");
}

describe("quoteFilterValue", () => {
  it("wraps in double quotes and escapes backslash and double quote", () => {
    expect(quoteFilterValue("nordic")).toBe('"nordic"');
    expect(quoteFilterValue('a"b')).toBe('"a\\"b"');
    expect(quoteFilterValue("a\\b")).toBe('"a\\\\b"');
    expect(quoteFilterValue('x" OR price > 0 OR y = "')).toBe('"x\\" OR price > 0 OR y = \\""');
  });

  it("refuses control characters", () => {
    expect(() => quoteFilterValue("a\u0000b")).toThrow(SearchFilterError);
    expect(() => quoteFilterValue("a\nb")).toThrow(SearchFilterError);
  });
});

describe("buildSearchFilter", () => {
  it("returns null for an empty selection", () => {
    expect(buildSearchFilter({})).toBeNull();
    expect(buildSearchFilter({ brands: [], options: {}, attributes: {} })).toBeNull();
  });

  it("builds one group with = for a single value and IN for several, quoting every value", () => {
    expect(buildSearchFilter({ brands: ["nordic"] })).toBe('brand = "nordic"');
    expect(buildSearchFilter({ brands: ["nordic", "other"] })).toBe('brand IN ["nordic", "other"]');
    expect(buildSearchFilter({ categories: [CATEGORY_A, CATEGORY_B] })).toBe(
      `categories IN ["${CATEGORY_A}", "${CATEGORY_B}"]`,
    );
    expect(buildSearchFilter({ options: { size: ["m", "l"] } })).toBe('opt_size IN ["m", "l"]');
  });

  it("removes duplicate values and keeps the order given", () => {
    expect(buildSearchFilter({ brands: ["b", "a", "b"] })).toBe('brand IN ["b", "a"]');
  });

  it("joins groups with AND in a fixed order: brand, category, in stock, options, attributes, price", () => {
    const filter = buildSearchFilter({
      price: { min: 100, max: 500 },
      attributes: {
        weight: { kind: "range", min: 1, max: 9 },
        material: { kind: "values", values: ["steel"] },
      },
      options: { size: ["m"], color: ["red", "blue"] },
      inStock: true,
      categories: [CATEGORY_A],
      brands: ["nordic"],
    });
    expect(filter).toBe(
      [
        'brand = "nordic"',
        `categories = "${CATEGORY_A}"`,
        "inStock = true",
        'opt_color IN ["red", "blue"]',
        'opt_size = "m"',
        'attr_material = "steel"',
        "attr_weight >= 1 AND attr_weight <= 9",
        "price >= 100 AND price <= 500",
      ].join(" AND "),
    );
  });

  it("supports boolean attributes, open ranges and in stock false", () => {
    expect(
      buildSearchFilter({ attributes: { waterproof: { kind: "boolean", value: true } } }),
    ).toBe("attr_waterproof = true");
    expect(buildSearchFilter({ price: { min: 100 } })).toBe("price >= 100");
    expect(buildSearchFilter({ price: { max: 500 } })).toBe("price <= 500");
    expect(buildSearchFilter({ inStock: false })).toBe("inStock = false");
    expect(buildSearchFilter({ attributes: { weight: { kind: "range", min: 1.5 } } })).toBe(
      "attr_weight >= 1.5",
    );
  });

  it("can leave one group out, for the disjunctive facet queries", () => {
    const selection: SearchSelection = {
      brands: ["nordic"],
      options: { size: ["m"] },
      price: { min: 1 },
    };
    expect(buildSearchFilter(selection, { omit: "brand" })).toBe('opt_size = "m" AND price >= 1');
    expect(buildSearchFilter(selection, { omit: "opt.size" })).toBe(
      'brand = "nordic" AND price >= 1',
    );
    expect(buildSearchFilter(selection, { omit: "price" })).toBe(
      'brand = "nordic" AND opt_size = "m"',
    );
    expect(buildSearchFilter({ brands: ["nordic"] }, { omit: "brand" })).toBeNull();
  });

  it("refuses values that are not slugs, uuids or codes (no filter injection)", () => {
    expect(reason({ brands: ['nordic" OR brand = "x'] })).toBe("invalid_value");
    expect(reason({ brands: ["Nordic"] })).toBe("invalid_value");
    expect(reason({ brands: ["nor dic"] })).toBe("invalid_value");
    expect(reason({ brands: ["a)"] })).toBe("invalid_value");
    expect(reason({ brands: ["a\u0000"] })).toBe("invalid_value");
    expect(reason({ categories: ["not-a-uuid"] })).toBe("invalid_value");
    expect(reason({ categories: [`${CATEGORY_A}" OR 1=1`] })).toBe("invalid_value");
    expect(reason({ options: { size: ['m" OR opt_size = "l'] } })).toBe("invalid_value");
    expect(reason({ options: { size: ["M"] } })).toBe("invalid_value");
    expect(reason({ attributes: { material: { kind: "values", values: ["a\\b"] } } })).toBe(
      "invalid_value",
    );
  });

  it("refuses field codes that are not codes (the code becomes part of a field name)", () => {
    expect(reason({ options: { "size OR price > 0": ["m"] } })).toBe("invalid_code");
    expect(reason({ options: { Size: ["m"] } })).toBe("invalid_code");
    expect(reason({ attributes: { "": { kind: "boolean", value: true } } })).toBe("invalid_code");
    expect(reason({ attributes: { "x y": { kind: "boolean", value: true } } })).toBe(
      "invalid_code",
    );
  });

  it("refuses bad numbers and ranges", () => {
    expect(reason({ price: { min: -1 } })).toBe("invalid_range");
    expect(reason({ price: { min: 1.5 } })).toBe("invalid_range");
    expect(reason({ price: { min: Number.NaN } })).toBe("invalid_range");
    expect(reason({ price: { max: Number.POSITIVE_INFINITY } })).toBe("invalid_range");
    expect(reason({ price: { max: Number.MAX_SAFE_INTEGER + 2 } })).toBe("invalid_range");
    expect(reason({ price: { min: 10, max: 5 } })).toBe("invalid_range");
    expect(reason({ price: {} })).toBe("invalid_range");
    expect(reason({ attributes: { weight: { kind: "range", min: Number.NaN } } })).toBe(
      "invalid_range",
    );
    expect(reason({ attributes: { weight: { kind: "range", min: 9, max: 1 } } })).toBe(
      "invalid_range",
    );
  });

  it("caps the number of values and of selected groups", () => {
    const many = Array.from({ length: SEARCH_LIMITS.maxSelectionValues + 1 }, (_, i) => `v${i}`);
    expect(reason({ options: { size: many } })).toBe("too_many_values");
    const groups = Object.fromEntries(
      Array.from({ length: SEARCH_LIMITS.maxSelectedGroups + 1 }, (_, i) => [`o${i}`, ["a"]]),
    );
    expect(reason({ options: groups })).toBe("too_many_groups");
    const total = Array.from({ length: 30 }, (_, i) => `v${i}`);
    expect(reason({ brands: total, options: { size: total } })).toBe("too_many_values");
  });
});
