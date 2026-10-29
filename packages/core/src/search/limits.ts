import { CATALOG_LIMITS } from "../catalog/limits.js";

/**
 * Version of the search document shape and of the text rules that build it (ADR 0033 decision 2). Bump it whenever a
 * document would come out different for the same catalog data, so every index is rebuilt.
 */
export const SEARCH_DOCUMENT_VERSION = 1;

/** Search limits, ADR 0033. Enforced by these rules and by the API at the boundary. */
export const SEARCH_LIMITS = Object.freeze({
  /** Characters of a query, counted in code points. */
  maxQueryLength: 200,
  /** The engine ignores later query terms (limit of 10 terms), so later words are dropped here. */
  maxQueryWords: 10,
  minSuggestLength: 2,
  maxSuggestions: 6,
  defaultPageSize: 24,
  maxPageSize: 48,
  /** Values over all selected facets of one request. */
  maxSelectionValues: 50,
  maxSelectedGroups: 8,
  /** Extra distinct queries for the counts of selected product-level facets (spike S1: about 45 ms each at 50 000 documents). */
  maxDisjunctiveQueries: 3,
  maxFacets: 20,
  /** Characters of the product description that are indexed, counted in code points. */
  maxDescriptionLength: 2000,
  /** `pagination.maxTotalHits` of the index: the engine pages through this many hits at most. */
  maxTotalHits: CATALOG_LIMITS.maxOffset,
  maxFacetValuesPerFacet: 100,
  /** Length of the prefix stems (spike S1: 5 letters beat 4 and 6). */
  prefixStemLength: 5,
});
