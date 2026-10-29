import { describe, expect, it } from "vitest";
import {
  SEARCH_LIMITS,
  deriveFacetSpecs,
  liveFacetSpecs,
  planSearchQueries,
  validatePageRequest,
} from "./index.js";
import type { FacetSpec, SearchSelection } from "./index.js";
import { assignment, attribute, selectAttribute } from "./test-support.js";

const specs: FacetSpec[] = deriveFacetSpecs({
  options: [{ code: "size" }, { code: "color" }],
  attributes: [
    assignment(selectAttribute("material", ["steel", "wood"], { isFilterable: true })),
    assignment(selectAttribute("supplier", ["a", "b"], { isFilterable: true })),
    assignment(selectAttribute("origin", ["ua", "pl"], { isFilterable: true })),
    assignment(attribute("waterproof", "boolean", { isFilterable: true })),
    assignment(attribute("weight", "number", { isFilterable: true }), "variant"),
  ],
});

describe("deriveFacetSpecs", () => {
  it("lists the fixed facets first, then options and attributes sorted by code", () => {
    expect(specs.map((spec) => spec.key)).toEqual([
      "brand",
      "category",
      "inStock",
      "opt.color",
      "opt.size",
      "attr.material",
      "attr.origin",
      "attr.supplier",
      "attr.waterproof",
      "attr.weight",
    ]);
  });

  it("describes the index field, the level and the kind of every facet", () => {
    const byKey = Object.fromEntries(specs.map((spec) => [spec.key, spec]));
    expect(byKey["brand"]).toEqual({
      key: "brand",
      field: "brand",
      level: "product",
      kind: "slug",
    });
    expect(byKey["category"]).toEqual({
      key: "category",
      field: "categories",
      level: "product",
      kind: "uuid",
    });
    expect(byKey["inStock"]).toEqual({
      key: "inStock",
      field: "inStock",
      level: "variant",
      kind: "boolean",
    });
    expect(byKey["opt.size"]).toEqual({
      key: "opt.size",
      field: "opt_size",
      level: "variant",
      kind: "code",
    });
    expect(byKey["attr.material"]).toEqual({
      key: "attr.material",
      field: "attr_material",
      level: "product",
      kind: "code",
    });
    expect(byKey["attr.waterproof"]?.kind).toBe("boolean");
    expect(byKey["attr.weight"]).toEqual({
      key: "attr.weight",
      field: "attr_weight",
      level: "variant",
      kind: "range",
    });
  });

  it("leaves out attributes that are not public, not filterable or not of a filterable type", () => {
    const result = deriveFacetSpecs({
      options: [],
      attributes: [
        assignment(
          selectAttribute("hidden", ["a"], { isFilterable: true, isVisibleOnStorefront: false }),
        ),
        // inconsistent data on purpose: the database forbids it, the rule must hold anyway
        assignment(selectAttribute("secret", ["a"], { isFilterable: true, isInternal: true })),
        assignment(selectAttribute("plain", ["a"], { isFilterable: false })),
        assignment(attribute("notes", "text", { isFilterable: true })),
        assignment(attribute("released", "date", { isFilterable: true })),
        assignment(selectAttribute("shown", ["a"], { isFilterable: true })),
      ],
    });
    expect(result.map((spec) => spec.key)).toEqual(["brand", "category", "inStock", "attr.shown"]);
  });

  it("treats an attribute used at both levels as a variant-level facet", () => {
    const result = deriveFacetSpecs({
      options: [],
      attributes: [
        assignment(selectAttribute("finish", ["a"], { isFilterable: true }), "product"),
        assignment(selectAttribute("finish", ["a"], { isFilterable: true }), "variant"),
      ],
    });
    expect(result.filter((spec) => spec.key === "attr.finish")).toEqual([
      { key: "attr.finish", field: "attr_finish", level: "variant", kind: "code" },
    ]);
  });
});

function plan(selection: SearchSelection, page = 1, pageSize = 24) {
  return planSearchQueries({ selection, specs, page, pageSize });
}

describe("liveFacetSpecs", () => {
  it("keeps only the facets whose field the live index can filter, in their order (review F1)", () => {
    // The definitions gained `opt.size` and `attr.weight`; job 13 has not applied them to the live index yet.
    const live = specs
      .map((spec) => spec.field)
      .filter((field) => field !== "opt_size" && field !== "attr_weight");
    expect(liveFacetSpecs(specs, live).map((spec) => spec.key)).toEqual(
      specs.map((spec) => spec.key).filter((key) => key !== "opt.size" && key !== "attr.weight"),
    );
  });

  it("never offers a field the live index has but the definitions no longer derive", () => {
    expect(liveFacetSpecs(specs, [...specs.map((spec) => spec.field), "attr_gone"])).toEqual(specs);
    expect(liveFacetSpecs(specs, [])).toEqual([]);
  });
});

describe("planSearchQueries", () => {
  it("without a selection: hits, variant facets and the price range", () => {
    const result = plan({});
    expect(result.countsFromMainQuery).toEqual([]);
    expect(result.queries).toEqual([
      {
        purpose: "hits",
        distinct: true,
        pagination: { kind: "page", page: 1, hitsPerPage: 24 },
        filter: null,
        facets: [
          "brand",
          "categories",
          "attr_material",
          "attr_origin",
          "attr_supplier",
          "attr_waterproof",
        ],
      },
      {
        purpose: "variant_facets",
        distinct: false,
        pagination: { kind: "limit", limit: 0 },
        filter: null,
        facets: ["inStock", "opt_color", "opt_size", "attr_weight"],
      },
      {
        purpose: "price_range",
        distinct: false,
        pagination: { kind: "limit", limit: 0 },
        filter: null,
        facets: ["price"],
      },
    ]);
  });

  it("passes the page and page size to the hits query", () => {
    const hits = plan({}, 3, 12).queries[0];
    expect(hits?.pagination).toEqual({ kind: "page", page: 3, hitsPerPage: 12 });
  });

  it("a selected product-level group gets a disjunctive query with distinct and hitsPerPage 0", () => {
    const result = plan({ brands: ["nordic"], options: { size: ["m"] } });
    const hits = result.queries.find((query) => query.purpose === "hits");
    expect(hits?.filter).toBe('brand = "nordic" AND opt_size = "m"');
    const brand = result.queries.find(
      (query) => query.purpose === "disjunctive" && query.facetKey === "brand",
    );
    expect(brand).toEqual({
      purpose: "disjunctive",
      facetKey: "brand",
      distinct: true,
      pagination: { kind: "page", page: 1, hitsPerPage: 0 },
      filter: 'opt_size = "m"',
      facets: ["brand"],
    });
  });

  it("a selected variant-level group gets a cheap disjunctive query without distinct", () => {
    const size = plan({ brands: ["nordic"], options: { size: ["m"] } }).queries.find(
      (query) => query.facetKey === "opt.size",
    );
    expect(size).toEqual({
      purpose: "disjunctive",
      facetKey: "opt.size",
      distinct: false,
      pagination: { kind: "limit", limit: 0 },
      filter: 'brand = "nordic"',
      facets: ["opt_size"],
    });
  });

  it("the price range ignores the price filter itself", () => {
    const range = plan({ brands: ["nordic"], price: { min: 10, max: 20 } }).queries.find(
      (query) => query.purpose === "price_range",
    );
    expect(range?.filter).toBe('brand = "nordic"');
    const hits = plan({ brands: ["nordic"], price: { min: 10, max: 20 } }).queries[0];
    expect(hits?.filter).toBe('brand = "nordic" AND price >= 10 AND price <= 20');
  });

  it("caps the distinct disjunctive queries and reports the groups served by the main query", () => {
    const selection: SearchSelection = {
      brands: ["nordic"],
      categories: ["0b1c3f5e-5d2a-4a56-8f0e-5f6a3c1d9a01"],
      attributes: {
        material: { kind: "values", values: ["steel"] },
        supplier: { kind: "values", values: ["a"] },
      },
    };
    const result = plan(selection);
    const disjunctive = result.queries.filter((query) => query.purpose === "disjunctive");
    expect(disjunctive).toHaveLength(SEARCH_LIMITS.maxDisjunctiveQueries);
    expect(disjunctive.map((query) => query.facetKey)).toEqual([
      "brand",
      "category",
      "attr.material",
    ]);
    expect(result.countsFromMainQuery).toEqual(["attr.supplier"]);
  });

  it("never asks for a distinct count with a limit: only the page/hitsPerPage path counts products exactly", () => {
    const selections: SearchSelection[] = [
      {},
      { brands: ["a"] },
      { options: { size: ["m"], color: ["red"] }, inStock: true },
      { brands: ["a"], categories: ["0b1c3f5e-5d2a-4a56-8f0e-5f6a3c1d9a01"], price: { min: 1 } },
      {
        attributes: {
          material: { kind: "values", values: ["x"] },
          weight: { kind: "range", min: 1 },
          waterproof: { kind: "boolean", value: true },
        },
      },
    ];
    for (const selection of selections) {
      for (const query of plan(selection).queries) {
        if (query.distinct) {
          expect(query.pagination.kind, `${query.purpose} ${query.facetKey ?? ""}`).toBe("page");
        }
      }
    }
  });

  it("refuses a selection for a facet that does not exist", () => {
    expect(() => plan({ options: { weight: ["x"] } })).toThrow(RangeError);
    expect(() => plan({ attributes: { secret: { kind: "boolean", value: true } } })).toThrow(
      RangeError,
    );
  });
});

describe("validatePageRequest", () => {
  it("accepts pages whose first hit is inside the 10 000 hits the engine can page through", () => {
    expect(validatePageRequest(1, 24)).toEqual({ ok: true, page: 1, pageSize: 24 });
    expect(validatePageRequest(209, 48)).toEqual({ ok: true, page: 209, pageSize: 48 });
    expect(validatePageRequest(417, 24)).toEqual({ ok: true, page: 417, pageSize: 24 });
  });

  it("refuses pages beyond the limit, bad numbers and page sizes above the maximum", () => {
    expect(validatePageRequest(418, 24)).toEqual({ ok: false, reason: "beyond_max_offset" });
    expect(validatePageRequest(210, 48)).toEqual({ ok: false, reason: "beyond_max_offset" });
    expect(validatePageRequest(0, 24)).toEqual({ ok: false, reason: "invalid_page" });
    expect(validatePageRequest(1.5, 24)).toEqual({ ok: false, reason: "invalid_page" });
    expect(validatePageRequest("2", 24)).toEqual({ ok: false, reason: "invalid_page" });
    expect(validatePageRequest(1, 0)).toEqual({ ok: false, reason: "invalid_page_size" });
    expect(validatePageRequest(1, 49)).toEqual({ ok: false, reason: "invalid_page_size" });
    expect(validatePageRequest(1, Number.NaN)).toEqual({ ok: false, reason: "invalid_page_size" });
  });
});
