import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CATALOG_REVALIDATE_SECONDS,
  SITEMAP_REVALIDATE_SECONDS,
  StoreUnavailableError,
  createStoreData,
  ensureLocalesSupported,
} from "./store-data";
import { LocaleMismatchError } from "./locale-check";

type Call = { url: string; init: RequestInit };

const config = {
  currency: "UAH",
  currencyExponent: 2,
  pricesIncludeTax: true,
  defaultLocale: "uk",
  locales: ["uk", "en"],
};

function json(body: unknown, status = 200, type = "application/json"): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": type } });
}

function problem(status: number, code: string): Response {
  return json(
    { type: "about:blank", title: "t", status, code, detail: "English detail, never shown" },
    status,
    "application/problem+json",
  );
}

function setup(handler: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const events: string[] = [];
  const data = createStoreData({
    baseUrl: () => "http://api.internal:3000",
    beforeRequest: async () => {
      events.push("beforeRequest");
    },
    fetch: async (url, init) => {
      events.push("fetch");
      calls.push({ url, init });
      return handler({ url, init }, calls.length - 1);
    },
  });
  return { data, calls, events };
}

afterEach(() => vi.restoreAllMocks());

describe("createStoreData requests", () => {
  it("uses a 60 second revalidation as an internal constant", () => {
    expect(CATALOG_REVALIDATE_SECONDS).toBe(60);
  });

  it("lets a caller choose the cache lifetime of one read (the sitemap uses an hour) and defaults to 60 seconds", async () => {
    expect(SITEMAP_REVALIDATE_SECONDS).toBe(3600);
    const { data, calls } = setup(() => json({ items: [], total: 0, limit: 100, offset: 0 }));
    await data.listProducts(
      "uk",
      { limit: 100 },
      { revalidateSeconds: SITEMAP_REVALIDATE_SECONDS },
    );
    await data.listProducts("uk", { limit: 100 });
    expect((calls[0]?.init as { next?: { revalidate?: number } }).next?.revalidate).toBe(3600);
    expect((calls[1]?.init as { next?: { revalidate?: number } }).next?.revalidate).toBe(60);
  });

  it("calls the API directly with ?locale=, the data cache options, tags and no cookies", async () => {
    const { data, calls } = setup(() => json({ items: [] }));
    await data.listCategories("en");
    const [call] = calls;
    expect(call?.url).toBe("http://api.internal:3000/store/categories?locale=en");
    expect(call?.init.method).toBe("GET");
    expect((call?.init as { next?: unknown }).next).toEqual({
      revalidate: 60,
      tags: ["store", "store:categories"],
    });
    const headers = new Headers(call?.init.headers);
    expect(headers.has("cookie")).toBe(false);
    expect(headers.has("X-Fluxkit-CSRF")).toBe(false);
  });

  it("passes the product list filters and tags the products", async () => {
    const { data, calls } = setup(() => json({ items: [], total: 0, limit: 8, offset: 0 }));
    await data.listProducts("uk", { limit: 8, category: "shoes", brand: "acme", offset: 16 });
    const url = new URL(calls[0]?.url ?? "");
    expect(url.pathname).toBe("/store/products");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      locale: "uk",
      limit: "8",
      category: "shoes",
      brand: "acme",
      offset: "16",
    });
    expect(((calls[0]?.init as { next?: { tags?: string[] } }).next ?? {}).tags).toEqual([
      "store",
      "store:products",
    ]);
  });

  it("waits for a request (beforeRequest) before any fetch, so nothing runs at build time", async () => {
    const { data, events } = setup(() => json(config));
    await data.getConfig();
    expect(events).toEqual(["beforeRequest", "fetch"]);
  });

  it("does not resolve the base URL before beforeRequest has finished", async () => {
    const order: string[] = [];
    const data = createStoreData({
      baseUrl: () => {
        order.push("baseUrl");
        return "http://api.internal:3000";
      },
      beforeRequest: async () => {
        order.push("beforeRequest");
      },
      fetch: async () => json(config),
    });
    await data.getConfig();
    expect(order).toEqual(["beforeRequest", "baseUrl"]);
  });
});

describe("createStoreData answers", () => {
  it("returns data for a success", async () => {
    const { data } = setup(() => json(config));
    expect(await data.getConfig()).toEqual({ ok: true, data: config, stale: false });
  });

  it("returns a 4xx problem as an answer (a missing product is a page decision, not an outage)", async () => {
    const { data } = setup(() => problem(404, "not_found"));
    const outcome = await data.getProduct("uk", "unknown");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.status).toBe(404);
      expect(outcome.problem.code).toBe("not_found");
    }
  });

  it("serves the last good response when the API fails afterwards, and says it is stale", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let mode: "ok" | "network" | "503" | "html" = "ok";
    const { data } = setup(() => {
      if (mode === "network") throw new TypeError("fetch failed");
      if (mode === "503") return problem(503, "service_unavailable");
      if (mode === "html") return new Response("<html>bad gateway</html>", { status: 502 });
      return json({ items: [{ id: "1" }] });
    });
    const first = await data.listCategories("uk");
    expect(first).toEqual({ ok: true, data: { items: [{ id: "1" }] }, stale: false });

    for (mode of ["network", "503", "html"] as const) {
      const stale = await data.listCategories("uk");
      expect(stale, mode).toEqual({ ok: true, data: { items: [{ id: "1" }] }, stale: true });
    }
    expect(warn).toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("keeps last good responses apart per locale and per query", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let down = false;
    const { data } = setup((call) => {
      if (down) throw new TypeError("fetch failed");
      return json({ items: [call.url] });
    });
    await data.listCategories("uk");
    down = true;
    await expect(data.listCategories("en")).rejects.toBeInstanceOf(StoreUnavailableError);
    expect(await data.listCategories("uk")).toMatchObject({ ok: true, stale: true });
  });

  it("throws StoreUnavailableError, logs it and shows no fallback data when nothing is cached", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { data } = setup(() => {
      throw new TypeError("fetch failed");
    });
    const failure = await data.getConfig().then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(failure).toBeInstanceOf(StoreUnavailableError);
    expect((failure as StoreUnavailableError).cause).toBeInstanceOf(Error);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("treats a 5xx problem without a cached copy as unavailable, not as an answer", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { data } = setup(() => problem(500, "internal_error"));
    await expect(data.listProducts("uk")).rejects.toBeInstanceOf(StoreUnavailableError);
  });

  it("does not cache a 4xx answer as a last good response", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let mode: "notfound" | "down" = "notfound";
    const { data } = setup(() => {
      if (mode === "down") throw new TypeError("fetch failed");
      return problem(404, "not_found");
    });
    await data.getProduct("uk", "x");
    mode = "down";
    await expect(data.getProduct("uk", "x")).rejects.toBeInstanceOf(StoreUnavailableError);
  });

  it("surfaces a missing API_INTERNAL_URL (baseUrl throwing) instead of hiding it", async () => {
    const data = createStoreData({
      baseUrl: () => {
        throw new Error("Invalid storefront environment: API_INTERNAL_URL: Required");
      },
      fetch: async () => json(config),
    });
    await expect(data.getConfig()).rejects.toThrow(/API_INTERNAL_URL/);
  });
});

describe("ensureLocalesSupported", () => {
  it("passes when the API serves every storefront locale", async () => {
    const { data } = setup(() => json(config));
    await expect(ensureLocalesSupported(data, ["uk", "en"])).resolves.toBeUndefined();
  });

  it("fails loudly when the API lacks a storefront locale", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { data } = setup(() => json({ ...config, locales: ["uk"] }));
    await expect(ensureLocalesSupported(data, ["uk", "en"])).rejects.toBeInstanceOf(
      LocaleMismatchError,
    );
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("fails when /store/config itself is refused", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { data } = setup(() => problem(400, "validation_failed"));
    await expect(ensureLocalesSupported(data, ["uk", "en"])).rejects.toThrow(/store\/config/);
  });
});
