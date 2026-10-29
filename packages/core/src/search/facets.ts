import { isPublicAttribute } from "../catalog/store-attributes.js";
import type { AttributeDefinition, AttributeLevel } from "../catalog/types.js";
import { FILTERABLE_INPUT_TYPES, SEARCH_FIELDS, attributeField, optionField } from "./fields.js";
import { buildSearchFilter, selectedGroupKeys } from "./filter.js";
import type { SearchSelection } from "./filter.js";
import { SEARCH_LIMITS } from "./limits.js";

/** An attribute definition with the level it has in a product type (`product_type_attribute.level`). */
export interface SearchAttributeAssignment {
  readonly definition: AttributeDefinition;
  readonly level: AttributeLevel;
}

export type FacetKind = "slug" | "uuid" | "code" | "boolean" | "range";

/**
 * One facet the search offers. `key` is the public name in URLs (`brand`, `category`, `inStock`, `opt.<code>`,
 * `attr.<code>`), `field` the field of the index. A product-level facet has the same value on every variant of a product,
 * so its counts are exact product counts; a variant-level facet is listed without counts (ADR 0034 decision 4).
 */
export interface FacetSpec {
  readonly key: string;
  readonly field: string;
  readonly level: "product" | "variant";
  readonly kind: FacetKind;
}

const FIXED_SPECS: readonly FacetSpec[] = [
  { key: "brand", field: SEARCH_FIELDS.brand, level: "product", kind: "slug" },
  { key: "category", field: SEARCH_FIELDS.categories, level: "product", kind: "uuid" },
  { key: "inStock", field: SEARCH_FIELDS.inStock, level: "variant", kind: "boolean" },
];

function kindOf(definition: AttributeDefinition): FacetKind | null {
  switch (definition.inputType) {
    case "select":
    case "multiselect":
      return "code";
    case "boolean":
      return "boolean";
    case "number":
      return "range";
    default:
      return null;
  }
}

/**
 * The facets of an index, from the option codes and the attribute assignments of all product types: the three fixed ones,
 * then options and attributes sorted by code. Only public, filterable attributes of a filterable type are facets, whatever
 * the other flags say (an internal attribute never is). An attribute assigned at both levels counts as variant-level.
 */
export function deriveFacetSpecs(input: {
  readonly options: readonly { readonly code: string }[];
  readonly attributes: readonly SearchAttributeAssignment[];
}): FacetSpec[] {
  const options: FacetSpec[] = [...new Set(input.options.map((option) => option.code))]
    .sort()
    .map((code) => ({
      key: `opt.${code}`,
      field: optionField(code),
      level: "variant" as const,
      kind: "code" as const,
    }));
  const attributes = new Map<string, FacetSpec>();
  for (const { definition, level } of input.attributes) {
    const kind = kindOf(definition);
    if (
      kind === null ||
      !definition.isFilterable ||
      !isPublicAttribute(definition) ||
      !FILTERABLE_INPUT_TYPES.includes(definition.inputType)
    ) {
      continue;
    }
    const known = attributes.get(definition.code);
    attributes.set(definition.code, {
      key: `attr.${definition.code}`,
      field: attributeField(definition.code),
      level: known?.level === "variant" || level === "variant" ? "variant" : "product",
      kind,
    });
  }
  const sortedAttributes = [...attributes.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, spec]) => spec);
  return [...FIXED_SPECS, ...options, ...sortedAttributes];
}

export type PageRequestError = "invalid_page" | "invalid_page_size" | "beyond_max_offset";

/** A page request the engine can serve: the first hit of the page must lie inside the 10 000 hits it pages through. */
export function validatePageRequest(
  page: unknown,
  pageSize: unknown,
):
  | { readonly ok: true; readonly page: number; readonly pageSize: number }
  | { readonly ok: false; readonly reason: PageRequestError } {
  if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 1) {
    return { ok: false, reason: "invalid_page" };
  }
  if (
    typeof pageSize !== "number" ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > SEARCH_LIMITS.maxPageSize
  ) {
    return { ok: false, reason: "invalid_page_size" };
  }
  if ((page - 1) * pageSize >= SEARCH_LIMITS.maxTotalHits) {
    return { ok: false, reason: "beyond_max_offset" };
  }
  return { ok: true, page, pageSize };
}

export type QueryPurpose = "hits" | "variant_facets" | "price_range" | "disjunctive";

/** How a planned query asks the engine for hits. `limit` 0 means no hits, only facets. */
export type QueryPagination =
  | { readonly kind: "page"; readonly page: number; readonly hitsPerPage: number }
  | { readonly kind: "limit"; readonly limit: 0 };

export interface PlannedQuery {
  readonly purpose: QueryPurpose;
  /** The facet whose counts this query is for (`disjunctive` only). */
  readonly facetKey?: string;
  /** Group hits by product (`distinct: productId`). */
  readonly distinct: boolean;
  readonly pagination: QueryPagination;
  /** The engine filter, from `buildSearchFilter`. */
  readonly filter: string | null;
  /** Index fields to count. */
  readonly facets: readonly string[];
}

export interface SearchQueryPlan {
  readonly queries: readonly PlannedQuery[];
  /** Selected product-level facets beyond the cap: their counts come from the `hits` query (conjunctive). */
  readonly countsFromMainQuery: readonly string[];
}

/**
 * The engine queries of one search page (ADR 0034 decision 4), to be sent next to the text queries in one multi-search.
 *
 * - `hits`: the page, grouped by product, with the counts of the product-level facets.
 * - `variant_facets`: the values of the variant-level facets, WITHOUT distinct (with distinct they lose values) and
 *   without hits, which is the cheap path.
 * - `price_range`: min and max price (`facetStats`), ignoring the price selection itself.
 * - `disjunctive`: for each selected facet the counts without its own filter, so its other values stay visible.
 *   Product-level ones use distinct with `page`/`hitsPerPage` 0: with distinct the engine counts products exactly only on
 *   the exhaustive path, `limit` 0 would count variants (spike S1, E3). At most three, the rest is reported in
 *   `countsFromMainQuery`.
 */
export function planSearchQueries(input: {
  readonly selection: SearchSelection;
  readonly specs: readonly FacetSpec[];
  readonly page: number;
  readonly pageSize: number;
}): SearchQueryPlan {
  const { selection, specs } = input;
  const productFields = specs.filter((spec) => spec.level === "product").map((spec) => spec.field);
  const variantFields = specs.filter((spec) => spec.level === "variant").map((spec) => spec.field);
  const queries: PlannedQuery[] = [
    {
      purpose: "hits",
      distinct: true,
      pagination: { kind: "page", page: input.page, hitsPerPage: input.pageSize },
      filter: buildSearchFilter(selection),
      facets: productFields,
    },
    {
      purpose: "variant_facets",
      distinct: false,
      pagination: { kind: "limit", limit: 0 },
      filter: buildSearchFilter(selection),
      facets: variantFields,
    },
    {
      purpose: "price_range",
      distinct: false,
      pagination: { kind: "limit", limit: 0 },
      filter: buildSearchFilter(selection, { omit: "price" }),
      facets: [SEARCH_FIELDS.price],
    },
  ];
  const countsFromMainQuery: string[] = [];
  let distinctQueries = 0;
  for (const key of selectedGroupKeys(selection)) {
    if (key === "price") {
      continue;
    }
    const spec = specs.find((candidate) => candidate.key === key);
    if (spec === undefined) {
      throw new RangeError(`The selection names a facet that does not exist: ${key}`);
    }
    const filter = buildSearchFilter(selection, { omit: key });
    if (spec.level === "variant") {
      queries.push({
        purpose: "disjunctive",
        facetKey: key,
        distinct: false,
        pagination: { kind: "limit", limit: 0 },
        filter,
        facets: [spec.field],
      });
    } else if (distinctQueries < SEARCH_LIMITS.maxDisjunctiveQueries) {
      distinctQueries++;
      queries.push({
        purpose: "disjunctive",
        facetKey: key,
        distinct: true,
        pagination: { kind: "page", page: 1, hitsPerPage: 0 },
        filter,
        facets: [spec.field],
      });
    } else {
      countsFromMainQuery.push(key);
    }
  }
  return { queries, countsFromMainQuery };
}
