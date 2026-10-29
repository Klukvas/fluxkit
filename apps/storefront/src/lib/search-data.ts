import {
  NetworkError,
  createStoreClient,
  type FetchLike,
  type SearchResult,
} from "@fluxkit/api-client";
import { retryAfterSeconds } from "./failure";
import { SERVER_READ_TIMEOUT_MS } from "./request-timeout";
import type { SearchQuery } from "./search-query";

/**
 * The results page's server-side read of `GET /store/search` (plan 2026-10-29-search.md, section 9). Server code only
 * (`search-data.server.ts` wires it to the environment and the request).
 *
 * - Never in the Next data cache (`cache: "no-store"`): the address holds free text, and `next start` writes every cached
 *   answer to disk and never deletes one (the same reason `GET /store/products?brand=` is not cached, `store-data.ts`).
 *   The API's own `Cache-Control: public, max-age=30` is for a shared cache in front of it. A `shared` read (the unfiltered
 *   catalog and category lists, `catalog-search.ts`) goes through the storefront's own bounded cache instead
 *   (`shared-search-cache.ts`, ADR 0040): one entry per locale and query for every shopper, the last good list served while
 *   the API answers 429 or 503.
 * - The shopper's forwarded address goes along (`forwarded-address.ts`), so the API's 60 a minute window counts shoppers
 *   and not this one server. Also on a shared read that misses: the read is made for the shopper whose view missed, so one
 *   client walking many list addresses uses up its own window, not the server's (review F1). A hit reads no header.
 * - An answer is a value, never a thrown error, for the states the page explains: search off (404), a selection the API
 *   refuses (400), a limit (429) and the engine being down (503, or an API that cannot be reached). A refusal by the engine
 *   (500) and everything unexpected throw, loud, and the route's error page renders.
 * - The words are never logged (AGENTS.md section 11).
 */

export type SearchOutcome =
  | { kind: "results"; result: SearchResult }
  /** `SEARCH_ENABLED=false` (the API answered 404): the page does not exist. */
  | { kind: "disabled" }
  /**
   * A parameter the API refuses (400): `range` for `invalid_range` (a number of a range it cannot read, review F4), `filter`
   * for anything else, for example a facet key that is not a facet (any more).
   */
  | { kind: "invalid"; reason: "range" | "filter" }
  | { kind: "rate_limited"; retryAfterSeconds: number | null }
  /** 503 `search_unavailable`, or the API could not be reached. */
  | { kind: "unavailable"; retryAfterSeconds: number | null };

/**
 * Where `shared` reads are kept (`shared-search-cache.ts` implements it; declared here, by its user, so that module depends
 * on this one and not the other way round).
 */
export interface SharedSearchCache {
  read(key: string, load: () => Promise<SearchOutcome>): Promise<SearchOutcome>;
  size(): number;
}

export interface SearchDataDependencies {
  /** Resolved after `beforeRequest`, at request time; throws (loudly) when `API_INTERNAL_URL` is missing or invalid. */
  baseUrl: () => string;
  /** The Next `connection()`: nothing here runs while Next prerenders. */
  beforeRequest?: () => Promise<unknown>;
  fetch?: FetchLike;
  readTimeoutMs?: number;
  /** The `X-Forwarded-For` chain of the page request, already checked (`forwardableAddresses`), or `null`. */
  forwardedFor?: () => Promise<string | null>;
  /** Where `shared` reads are kept; without it a shared read is an ordinary read. */
  sharedCache?: SharedSearchCache;
}

export interface SearchReadOptions {
  /** One answer for every shopper (bounded addresses only: no words, facet values or price), kept by `sharedCache`. */
  shared?: boolean;
}

export interface SearchData {
  search(locale: string, query: SearchQuery, read?: SearchReadOptions): Promise<SearchOutcome>;
}

export function createSearchData(dependencies: SearchDataDependencies): SearchData {
  return {
    async search(locale, query, read) {
      await dependencies.beforeRequest?.();
      const cache = read?.shared === true ? dependencies.sharedCache : undefined;
      if (cache === undefined) return readSearch(dependencies, locale, query);
      const key = JSON.stringify([
        locale,
        query.q,
        query.facets,
        query.price,
        query.sort,
        query.page,
      ]);
      return cache.read(key, () => readSearch(dependencies, locale, query));
    },
  };
}

async function readSearch(
  dependencies: SearchDataDependencies,
  locale: string,
  query: SearchQuery,
): Promise<SearchOutcome> {
  const forwarded = (await dependencies.forwardedFor?.()) ?? null;
  const inner: FetchLike = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
  const client = createStoreClient({
    baseUrl: dependencies.baseUrl(),
    fetch: (url, init) =>
      inner(
        url,
        forwarded === null
          ? init
          : {
              ...init,
              headers: {
                ...(init.headers as Record<string, string>),
                "X-Forwarded-For": forwarded,
              },
            },
      ),
  });

  let outcome;
  try {
    outcome = await client.searchProducts({
      locale,
      ...(query.q === "" ? {} : { q: query.q }),
      ...(query.facets.length === 0 ? {} : { f: query.facets }),
      ...(query.price === null
        ? {}
        : { price: `${query.price.min ?? ""}..${query.price.max ?? ""}` }),
      ...(query.sort === null ? {} : { sort: query.sort }),
      ...(query.page > 1 ? { page: query.page } : {}),
      signal: AbortSignal.timeout(dependencies.readTimeoutMs ?? SERVER_READ_TIMEOUT_MS),
      fetchOptions: { cache: "no-store" },
    });
  } catch (thrown) {
    if (thrown instanceof NetworkError) {
      // The cause is named by type, not by message: undici puts addresses and URLs in messages.
      const cause = thrown.cause;
      const name = cause instanceof Error ? cause.name : typeof cause;
      console.error(
        `GET /store/search could not be read (${name}); the page says search is unavailable.`,
      );
      return { kind: "unavailable", retryAfterSeconds: null };
    }
    throw thrown;
  }

  if (outcome.ok) return { kind: "results", result: outcome.data };
  const wait = retryAfterSeconds(outcome.retryAfter);
  switch (true) {
    case outcome.status === 404:
      return { kind: "disabled" };
    case outcome.status === 400:
      return {
        kind: "invalid",
        reason: (outcome.problem.errors ?? []).some((error) => error.code === "invalid_range")
          ? "range"
          : "filter",
      };
    case outcome.status === 429:
      return { kind: "rate_limited", retryAfterSeconds: wait };
    case outcome.status === 503 && outcome.problem.code === "search_unavailable":
      return { kind: "unavailable", retryAfterSeconds: wait };
    default: {
      const message = `GET /store/search answered ${String(outcome.status)} ${outcome.problem.code}`;
      console.error(message);
      throw new Error(message);
    }
  }
}
