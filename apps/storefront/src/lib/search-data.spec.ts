import type { SearchResult } from "@fluxkit/api-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSearchData } from "./search-data";
import { json, problem } from "./test-fetch";
import type { SearchQuery } from "./search-query";

const result: SearchResult = {
  items: [],
  total: 0,
  page: 1,
  pageCount: 0,
  limit: 24,
  sort: "newest",
  relaxed: false,
  query: { normalized: "x" },
  facets: [],
  price: null,
};

const query: SearchQuery = {
  q: "secret words",
  facets: ["brand:acme", "opt.size:m"],
  price: { min: 100, max: null },
  sort: "price_asc",
  page: 2,
};

type Call = { url: string; init: RequestInit };

function setup(
  handler: (call: Call) => Response | Promise<Response>,
  extra: { forwardedFor?: () => Promise<string | null> } = {},
) {
  const calls: Call[] = [];
  const events: string[] = [];
  const data = createSearchData({
    baseUrl: () => "http://api.internal:3000",
    beforeRequest: async () => {
      events.push("beforeRequest");
    },
    fetch: async (url, init) => {
      events.push("fetch");
      calls.push({ url, init });
      return handler({ url, init });
    },
    ...extra,
  });
  return { data, calls, events };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("search data (the results page's server read of GET /store/search)", () => {
  it("asks for the words, the facets, the price, the sort, the page and the locale, never for a limit", async () => {
    const { data, calls, events } = setup(() => json(result));
    const outcome = await data.search("en", query);
    expect(outcome).toEqual({ kind: "results", result });
    const url = new URL(calls[0]?.url ?? "");
    expect(url.origin + url.pathname).toBe("http://api.internal:3000/store/search");
    expect(url.searchParams.get("q")).toBe("secret words");
    expect(url.searchParams.getAll("f")).toEqual(["brand:acme", "opt.size:m"]);
    expect(url.searchParams.get("price")).toBe("100..");
    expect(url.searchParams.get("sort")).toBe("price_asc");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("locale")).toBe("en");
    expect(url.searchParams.has("limit")).toBe(false);
    // Connection first, so a build never needs the API.
    expect(events).toEqual(["beforeRequest", "fetch"]);
  });

  it("leaves out what is not selected", async () => {
    const { data, calls } = setup(() => json(result));
    await data.search("uk", { q: "", facets: [], price: null, sort: null, page: 1 });
    expect(new URL(calls[0]?.url ?? "").search).toBe("?locale=uk");
  });

  it("keeps the answer out of the Next data cache (the address holds free text, so the cache would grow without bound) and sends no cookie", async () => {
    const { data, calls } = setup(() => json(result));
    await data.search("uk", query);
    const init = calls[0]?.init as RequestInit & { next?: unknown };
    expect(init.cache).toBe("no-store");
    expect(init.next).toBeUndefined();
    expect(new Headers(init.headers).has("cookie")).toBe(false);
  });

  it("ends the read after the server limit", async () => {
    const { data, calls } = setup(() => json(result));
    await data.search("uk", query);
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("passes the shopper's forwarded address on, so the API's per-address window counts the shopper", async () => {
    const { data, calls } = setup(() => json(result), {
      forwardedFor: async () => "203.0.113.5",
    });
    await data.search("uk", query);
    expect(new Headers(calls[0]?.init.headers).get("x-forwarded-for")).toBe("203.0.113.5");
  });

  it("on request, caches a read of the catalog pages for the given seconds and then forwards no address (one cache entry for every shopper)", async () => {
    const forwardedFor = vi.fn(async () => "203.0.113.5");
    const { data, calls } = setup(() => json(result), { forwardedFor });
    await data.search("uk", { ...query, q: "", facets: [], price: null }, { cacheSeconds: 60 });
    const init = calls[0]?.init as RequestInit & {
      next?: { revalidate?: number; tags?: string[] };
    };
    expect(init.cache).toBeUndefined();
    expect(init.next).toEqual({ revalidate: 60, tags: ["store", "store:search"] });
    expect(new Headers(init.headers).has("x-forwarded-for")).toBe(false);
    expect(forwardedFor).not.toHaveBeenCalled();
  });

  it("sends no forwarded address when the request had none", async () => {
    const { data, calls } = setup(() => json(result), { forwardedFor: async () => null });
    await data.search("uk", query);
    expect(new Headers(calls[0]?.init.headers).has("x-forwarded-for")).toBe(false);
  });

  it.each([
    [404, "not_found", [], { kind: "disabled" }],
    [400, "validation_failed", [], { kind: "invalid", reason: "filter" }],
    [
      400,
      "validation_failed",
      [{ path: "f", code: "unknown_facet_key" }],
      { kind: "invalid", reason: "filter" },
    ],
    // A range the API cannot read is named as such, not as a filter that does not exist (review F4). The API's shape:
    // `validation_failed` with the reason in `errors[].code` (apps/api/src/search/store/store-search.spec.ts).
    [
      400,
      "validation_failed",
      [{ path: "f", code: "invalid_range" }],
      { kind: "invalid", reason: "range" },
    ],
    [
      400,
      "validation_failed",
      [{ path: "price", code: "invalid_range" }],
      { kind: "invalid", reason: "range" },
    ],
  ])("reads a %i %s with the errors %j as %j", async (status, code, errors, expected) => {
    const { data } = setup(() => problem(status, code, { errors }));
    await expect(data.search("uk", query)).resolves.toEqual(expected);
  });

  it("reads 429 with the seconds to wait, and 503 search_unavailable with its Retry-After", async () => {
    const limited = setup(() => problem(429, "too_many_requests", {}, { "Retry-After": "42" }));
    await expect(limited.data.search("uk", query)).resolves.toEqual({
      kind: "rate_limited",
      retryAfterSeconds: 42,
    });
    const down = setup(() => problem(503, "search_unavailable", {}, { "Retry-After": "30" }));
    await expect(down.data.search("uk", query)).resolves.toEqual({
      kind: "unavailable",
      retryAfterSeconds: 30,
    });
    const noHeader = setup(() => problem(503, "search_unavailable"));
    await expect(noHeader.data.search("uk", query)).resolves.toEqual({
      kind: "unavailable",
      retryAfterSeconds: null,
    });
  });

  it("does not hide an engine refusal or any other server error: it throws, so the route's error page renders", async () => {
    const { data } = setup(() => problem(500, "internal_error"));
    await expect(data.search("uk", query)).rejects.toThrow(/GET \/store\/search answered 500/);
    const other = setup(() => problem(503, "service_unavailable"));
    await expect(other.data.search("uk", query)).rejects.toThrow(/answered 503/);
  });

  it("reads an unreachable API as search unavailable and logs the failure without the words", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { data } = setup(() => {
      throw new TypeError("fetch failed secret words");
    });
    await expect(data.search("uk", query)).resolves.toEqual({
      kind: "unavailable",
      retryAfterSeconds: null,
    });
    const logged = error.mock.calls.flat().join(" ");
    expect(logged).toContain("GET /store/search");
    expect(logged).not.toContain("secret");
    expect(logged).not.toContain("words");
  });

  it("never logs the words, not even for a refusal", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { data } = setup(() => problem(500, "internal_error"));
    await expect(data.search("uk", query)).rejects.toThrow();
    expect(error.mock.calls.flat().join(" ")).not.toContain("secret");
  });
});
