import {
  createStoreClient,
  type CallOptions,
  type FetchLike,
  type ListProductsOptions,
  type ProblemDetails,
  type ProductDetail,
  type ProductList,
  type CategoryList,
  type StoreConfig,
  type StoreClient,
  type StoreResult,
} from "@fluxkit/api-client";
import { assertLocalesSupported } from "./locale-check";
import { SERVER_READ_TIMEOUT_MS } from "./request-timeout";

/**
 * Server-side reads of the public catalog (ADR 0026): the Next server calls the API directly at `API_INTERNAL_URL`, never
 * with cookies, always with `?locale=` from the route. Responses go through the Next data cache for this long. An internal
 * constant, not configuration: 60 seconds is the staleness the plan accepts for catalog pages (the cart is authoritative).
 */
export const CATALOG_REVALIDATE_SECONDS = 60;

/** Staleness the sitemap accepts (plan, rendering table: 1 hour). A sitemap is crawled, not browsed. */
export const SITEMAP_REVALIDATE_SECONDS = 3600;

/** Data cache tags. No catalog events exist yet, so nothing revalidates by tag; they are here for the day it does. */
export const STORE_TAGS = {
  all: "store",
  config: "store:config",
  categories: "store:categories",
  products: "store:products",
} as const;

/** Most last-good responses kept in memory per server process (oldest dropped first). */
const LAST_GOOD_LIMIT = 200;

export type CatalogOutcome<T> =
  { ok: true; data: T; stale: boolean } | { ok: false; status: number; problem: ProblemDetails };

/** The API cannot be reached or answers 5xx, and no earlier good response is in memory: the route's error.tsx renders. */
export class StoreUnavailableError extends Error {
  constructor(operation: string, cause: unknown) {
    super(`The store API is unavailable for ${operation} and no cached response exists.`, {
      cause,
    });
    this.name = "StoreUnavailableError";
  }
}

export interface StoreDataDependencies {
  /** Resolved after `beforeRequest`, at request time; throws (loudly) when `API_INTERNAL_URL` is missing or invalid. */
  baseUrl: () => string;
  /** The Next `connection()`: a catalog fetch never runs while Next prerenders (the build must not need the API). */
  beforeRequest?: () => Promise<unknown>;
  fetch?: FetchLike;
  /** Longest a catalog read may take; `SERVER_READ_TIMEOUT_MS` by default. */
  readTimeoutMs?: number;
}

export interface ReadOptions {
  /** Data cache lifetime of this read; the default is `CATALOG_REVALIDATE_SECONDS`. */
  revalidateSeconds?: number;
  /** Keep this read out of the Next data cache (`cache: "no-store"`). Set for reads whose URL holds a free value. */
  noStore?: boolean;
}

type ProductListQuery = Omit<ListProductsOptions, "locale" | "signal" | "fetchOptions">;

/**
 * Whether a product list may enter the Next data cache. `next start` writes every cached answer to `.next/cache/fetch-cache`
 * and never deletes one, so the cache key space must be bounded: the brand filter is a free slug the visitor chooses (there
 * is no brand list to validate it against), so every distinct value would add a file. Everything else in a list URL is
 * bounded: the locale, a category that exists (the page checks it first), the page size and an offset below the API's cap.
 */
export function isCacheableProductQuery(query: ProductListQuery): boolean {
  return query.brand === undefined;
}

export interface StoreData {
  getConfig(read?: ReadOptions): Promise<CatalogOutcome<StoreConfig>>;
  listCategories(locale: string, read?: ReadOptions): Promise<CatalogOutcome<CategoryList>>;
  listProducts(
    locale: string,
    options?: ProductListQuery,
    read?: ReadOptions,
  ): Promise<CatalogOutcome<ProductList>>;
  getProduct(locale: string, slug: string): Promise<CatalogOutcome<ProductDetail>>;
}

export function createStoreData(dependencies: StoreDataDependencies): StoreData {
  // Last good answers, for an outage after the Next data cache entry has expired. In memory, per process, not shared.
  const lastGood = new Map<string, unknown>();

  function remember(key: string, data: unknown): void {
    lastGood.delete(key);
    lastGood.set(key, data);
    if (lastGood.size > LAST_GOOD_LIMIT) {
      const oldest = lastGood.keys().next();
      if (!oldest.done) lastGood.delete(oldest.value);
    }
  }

  async function run<T>(
    operation: string,
    cacheKey: string,
    tag: string,
    read: ReadOptions,
    call: (client: StoreClient, options: CallOptions) => Promise<StoreResult<T>>,
  ): Promise<CatalogOutcome<T>> {
    await dependencies.beforeRequest?.();
    const client = createStoreClient({
      baseUrl: dependencies.baseUrl(),
      ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
    });
    const options: CallOptions = {
      // A hung API ends here (review M1) and the last good copy or error.tsx takes over, instead of after undici's 300 s.
      signal: AbortSignal.timeout(dependencies.readTimeoutMs ?? SERVER_READ_TIMEOUT_MS),
      // Next warns when both `cache: "no-store"` and `next.revalidate` are given, so a no-store read carries only the first.
      fetchOptions:
        read.noStore === true
          ? { cache: "no-store" }
          : {
              next: {
                revalidate: read.revalidateSeconds ?? CATALOG_REVALIDATE_SECONDS,
                tags: [STORE_TAGS.all, tag],
              },
            },
    };

    let failure: unknown;
    try {
      const result = await call(client, options);
      if (result.ok) {
        remember(cacheKey, result.data);
        return { ok: true, data: result.data, stale: false };
      }
      if (result.status < 500) {
        return { ok: false, status: result.status, problem: result.problem };
      }
      failure = new Error(`${operation} answered ${result.status} ${result.problem.code}`);
    } catch (thrown) {
      failure = thrown;
    }

    if (lastGood.has(cacheKey)) {
      console.warn(
        `${operation} failed (${describe(failure)}); serving the last good response from memory.`,
      );
      return { ok: true, data: lastGood.get(cacheKey) as T, stale: true };
    }
    console.error(`${operation} failed and no cached response exists: ${describe(failure)}`);
    throw new StoreUnavailableError(operation, failure);
  }

  return {
    getConfig: (read = {}) =>
      run("GET /store/config", "config", STORE_TAGS.config, read, (client, options) =>
        client.getConfig(options),
      ),
    listCategories: (locale, read = {}) =>
      run(
        "GET /store/categories",
        `categories:${locale}`,
        STORE_TAGS.categories,
        read,
        (client, options) => client.listCategories({ ...options, locale }),
      ),
    listProducts: (locale, query = {}, read = {}) =>
      run(
        "GET /store/products",
        `products:${locale}:${JSON.stringify(query)}`,
        STORE_TAGS.products,
        isCacheableProductQuery(query) ? read : { ...read, noStore: true },
        (client, options) => client.listProducts({ ...query, ...options, locale }),
      ),
    getProduct: (locale, slug) =>
      run(
        "GET /store/products/{slug}",
        `product:${locale}:${slug}`,
        STORE_TAGS.products,
        {},
        (client, options) => client.getProduct(slug, { ...options, locale }),
      ),
  };
}

function describe(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/**
 * Request-time check that every locale the storefront renders is in `GET /store/config` `locales`. The config answer is
 * cached like the catalog, so this costs one cached read per request. Throws (and logs) on a mismatch and when the config
 * cannot be read: the route's error.tsx renders.
 */
export async function ensureLocalesSupported(
  data: StoreData,
  storefrontLocales: readonly string[],
): Promise<void> {
  const outcome = await data.getConfig();
  if (!outcome.ok) {
    const message = `GET /store/config answered ${outcome.status} ${outcome.problem.code}, so the storefront locales cannot be checked.`;
    console.error(message);
    throw new Error(message);
  }
  assertLocalesSupported(storefrontLocales, outcome.data);
}
