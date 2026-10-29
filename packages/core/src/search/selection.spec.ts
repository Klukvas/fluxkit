import { describe, expect, it } from "vitest";
import { SEARCH_LIMITS, deriveFacetSpecs, parseSelectionParams } from "./index.js";
import { assignment, attribute, selectAttribute } from "./test-support.js";

const CATEGORY = "0b1c3f5e-5d2a-4a56-8f0e-5f6a3c1d9a01";

const specs = deriveFacetSpecs({
  options: [{ code: "size" }, { code: "color" }],
  attributes: [
    assignment(selectAttribute("material", ["steel", "wood"], { isFilterable: true })),
    assignment(attribute("waterproof", "boolean", { isFilterable: true })),
    assignment(attribute("weight", "number", { isFilterable: true }), "variant"),
  ],
});

describe("parseSelectionParams", () => {
  it("turns the repeated f parameters and the price into a typed selection", () => {
    expect(
      parseSelectionParams(
        {
          f: [
            "brand:nordic",
            "brand:other",
            `category:${CATEGORY}`,
            "opt.size:m",
            "opt.size:l",
            "inStock:true",
            "attr.material:steel",
            "attr.waterproof:false",
            "attr.weight:100..500",
          ],
          price: "1000..5000",
        },
        specs,
      ),
    ).toEqual({
      ok: true,
      selection: {
        brands: ["nordic", "other"],
        categories: [CATEGORY],
        inStock: true,
        options: { size: ["m", "l"] },
        attributes: {
          material: { kind: "values", values: ["steel"] },
          waterproof: { kind: "boolean", value: false },
          weight: { kind: "range", min: 100, max: 500 },
        },
        price: { min: 1000, max: 5000 },
      },
    });
  });

  it("accepts no parameters at all", () => {
    expect(parseSelectionParams({}, specs)).toEqual({ ok: true, selection: {} });
    expect(parseSelectionParams({ f: [] }, specs)).toEqual({ ok: true, selection: {} });
  });

  it("accepts open ranges", () => {
    expect(parseSelectionParams({ price: "..5000" }, specs)).toEqual({
      ok: true,
      selection: { price: { max: 5000 } },
    });
    expect(parseSelectionParams({ price: "1000.." }, specs)).toEqual({
      ok: true,
      selection: { price: { min: 1000 } },
    });
    expect(parseSelectionParams({ f: ["attr.weight:1.5..2.5"] }, specs)).toEqual({
      ok: true,
      selection: { attributes: { weight: { kind: "range", min: 1.5, max: 2.5 } } },
    });
  });

  it("refuses an unknown facet key instead of ignoring it", () => {
    for (const param of [
      "color:red",
      "opt.weight:1",
      "attr.secret:x",
      "attr.size:m",
      "price:1..2",
      "Brand:a",
    ]) {
      expect(parseSelectionParams({ f: [param] }, specs)).toEqual({
        ok: false,
        error: { reason: "unknown_facet_key", param },
      });
    }
  });

  it("refuses a parameter without a value", () => {
    for (const param of ["brand", "brand:", ":nordic", ""]) {
      expect(parseSelectionParams({ f: [param] }, specs)).toEqual({
        ok: false,
        error: { reason: "malformed", param },
      });
    }
  });

  it("refuses values that do not fit the kind of the facet", () => {
    for (const param of [
      "brand:Nordic",
      'brand:a"b',
      "category:12",
      "opt.size:M",
      "inStock:maybe",
      "attr.waterproof:1",
      "attr.weight:abc",
      "attr.material:",
    ]) {
      const result = parseSelectionParams({ f: [param] }, specs);
      expect(result.ok, param).toBe(false);
    }
    expect(parseSelectionParams({ f: ["inStock:maybe"] }, specs)).toEqual({
      ok: false,
      error: { reason: "invalid_value", param: "inStock:maybe" },
    });
  });

  it("refuses a boolean or a range given twice", () => {
    expect(parseSelectionParams({ f: ["inStock:true", "inStock:false"] }, specs)).toEqual({
      ok: false,
      error: { reason: "invalid_value", param: "inStock:false" },
    });
    expect(parseSelectionParams({ f: ["attr.weight:1..2", "attr.weight:3..4"] }, specs)).toEqual({
      ok: false,
      error: { reason: "invalid_value", param: "attr.weight:3..4" },
    });
  });

  it("refuses bad ranges", () => {
    for (const price of ["abc", "5..1", "..", "-1..5", "1.5..2", "1..2..3", ""]) {
      expect(parseSelectionParams({ price }, specs), price).toEqual({
        ok: false,
        error: { reason: "invalid_range", param: "price" },
      });
    }
    expect(parseSelectionParams({ f: ["attr.weight:5..1"] }, specs)).toEqual({
      ok: false,
      error: { reason: "invalid_range", param: "attr.weight:5..1" },
    });
  });

  it("caps the number of f parameters and of selected groups", () => {
    const many = Array.from(
      { length: SEARCH_LIMITS.maxSelectionValues + 1 },
      (_, i) => `brand:b${i}`,
    );
    expect(parseSelectionParams({ f: many }, specs)).toEqual({
      ok: false,
      error: { reason: "too_many_values", param: "f" },
    });
    const wideSpecs = deriveFacetSpecs({
      options: Array.from({ length: SEARCH_LIMITS.maxSelectedGroups + 1 }, (_, i) => ({
        code: `o${i}`,
      })),
      attributes: [],
    });
    const groups = Array.from(
      { length: SEARCH_LIMITS.maxSelectedGroups + 1 },
      (_, i) => `opt.o${i}:a`,
    );
    expect(parseSelectionParams({ f: groups }, wideSpecs)).toEqual({
      ok: false,
      error: { reason: "too_many_groups", param: "f" },
    });
  });

  it("does not repeat a value given twice", () => {
    expect(parseSelectionParams({ f: ["brand:a", "brand:a"] }, specs)).toEqual({
      ok: true,
      selection: { brands: ["a"] },
    });
  });
});
