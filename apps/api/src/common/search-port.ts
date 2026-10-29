/**
 * The extension point between the catalog, price, stock and order code and catalog search (ADR 0034 decision 1): code
 * outside `apps/api/src/search/` sees only this port, never the search module (dependency-cruiser rule
 * `api-must-not-import-search`). The search module provides it; with `SEARCH_ENABLED=false` it reports `enabled: false`.
 */
export const SEARCH_PORT = Symbol("SEARCH_PORT");

export interface SearchPort {
  /** `SEARCH_ENABLED`: the `search` flag of both config routes. */
  readonly enabled: boolean;
}

export const DISABLED_SEARCH_PORT: SearchPort = Object.freeze({ enabled: false });
