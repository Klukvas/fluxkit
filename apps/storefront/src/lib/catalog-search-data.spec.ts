import type { SearchResult } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import { loadCatalogSearchPage } from "./catalog-search-data";
import type { SearchData, SearchOutcome, SearchReadOptions } from "./search-data";
import type { SearchQuery } from "./search-query";
import type { CatalogOutcome, StoreData } from "./store-data";
import { category, summary } from "./test-fixtures";

const config = {
  currency: "UAH",
  currencyExponent: 2,
  pricesIncludeTax: true,
  defaultLocale: "uk",
  locales: ["uk", "en"],
  emailDelivery: false,
  onlinePayment: false,
  search: true,
};

function ok<T>(data: T): CatalogOutcome<T> {
  return { ok: true, data, stale: false };
}

const result: SearchResult = {
  items: [summary("found")],
  total: 30,
  page: 1,
  pageCount: 2,
  limit: 24,
  sort: "newest",
  relaxed: false,
  query: { normalized: "" },
  facets: [],
  price: { min: 100, max: 900 },
};

const empty: SearchQuery = { q: "", facets: [], price: null, sort: null, page: 1 };

function fakes(answer: SearchOutcome | (() => Promise<SearchOutcome>)) {
  const searches: { locale: string; query: SearchQuery; read: SearchReadOptions | undefined }[] =
    [];
  const listings: unknown[][] = [];
  const store: StoreData = {
    getConfig: async () => ok(config),
    listCategories: async () => ok({ items: [category("clothing", [category("tops")])] }),
    listProducts: async (...args: unknown[]) => {
      listings.push(args);
      return ok({ items: [summary("sql")], total: 1, limit: 24, offset: 0 });
    },
    getProduct: async () => {
      throw new Error("not used");
    },
  };
  const search: SearchData = {
    async search(locale, query, read) {
      searches.push({ locale, query, read });
      return typeof answer === "function" ? answer() : answer;
    },
  };
  return { store, search, searches, listings };
}

describe("catalog and category pages with search on (plan section 9, question 3)", () => {
  it("reads GET /store/search for the catalog: facets and sort come from the index", async () => {
    const { store, search, searches, listings } = fakes({ kind: "results", result });
    const read = { ...empty, facets: ["opt.size:m"], sort: "price_asc" as const };
    const page = await loadCatalogSearchPage(store, search, "en", { query: read });
    expect(page).toEqual({ kind: "search", result, category: null, trail: [] });
    expect(searches).toEqual([{ locale: "en", query: read, read: undefined }]);
    expect(listings).toEqual([]);
  });

  it("filters a category page by the category's id (the API matches its descendants too)", async () => {
    const { store, search, searches } = fakes({ kind: "results", result });
    const page = await loadCatalogSearchPage(store, search, "en", {
      categorySlug: "tops",
      query: empty,
    });
    expect(page.kind).toBe("search");
    if (page.kind !== "search") return;
    expect(page.category?.slug).toBe("tops");
    expect(page.trail.map((node) => node.slug)).toEqual(["clothing", "tops"]);
    expect(searches[0]?.query.facets).toEqual(["category:category-tops"]);
  });

  it("is not found for an unknown category, without asking the index", async () => {
    const { store, search, searches } = fakes({ kind: "results", result });
    expect(
      await loadCatalogSearchPage(store, search, "en", { categorySlug: "nope", query: empty }),
    ).toEqual({ kind: "not_found" });
    expect(searches).toEqual([]);
  });

  it("is not found past the last page of the result, like the SQL listing", async () => {
    const { store, search } = fakes({ kind: "results", result });
    expect(
      await loadCatalogSearchPage(store, search, "en", { query: { ...empty, page: 3 } }),
    ).toEqual({ kind: "not_found" });
    expect(
      (await loadCatalogSearchPage(store, search, "en", { query: { ...empty, page: 2 } })).kind,
    ).toBe("search");
  });

  it("caches the unfiltered list for the catalog minute and keeps filtered reads out of the data cache", async () => {
    const { store, search, searches } = fakes({ kind: "results", result });
    await loadCatalogSearchPage(store, search, "en", { query: { ...empty, sort: "price_desc" } });
    await loadCatalogSearchPage(store, search, "en", {
      query: { ...empty, facets: ["brand:a"] },
    });
    expect(searches.map((entry) => entry.read)).toEqual([{ cacheSeconds: 60 }, undefined]);
  });

  for (const outcome of [
    { kind: "unavailable", retryAfterSeconds: 30 },
    { kind: "rate_limited", retryAfterSeconds: 12 },
    { kind: "disabled" },
  ] as const) {
    it(`falls back to the SQL listing (newest first) and says so when search answers ${outcome.kind}`, async () => {
      const { store, search, listings } = fakes(outcome);
      const page = await loadCatalogSearchPage(store, search, "en", {
        categorySlug: "tops",
        query: { ...empty, facets: ["brand:demo-brand", "opt.size:m"], page: 1 },
      });
      expect(page.kind).toBe("fallback");
      if (page.kind !== "fallback") return;
      expect(page.dropped).toBe(true);
      expect(page.listing.products.items.map((item) => item.slug)).toEqual(["sql"]);
      // The SQL listing applies what it can: the category, one brand and the page.
      expect(listings).toEqual([
        ["en", { limit: 24, offset: 0, category: "tops", brand: "demo-brand" }],
      ]);
    });
  }

  it("does not claim dropped filters when the address had none the SQL listing cannot apply", async () => {
    const { store, search } = fakes({ kind: "unavailable", retryAfterSeconds: null });
    const page = await loadCatalogSearchPage(store, search, "en", { query: empty });
    expect(page).toMatchObject({ kind: "fallback", dropped: false });
  });

  it("is not found when the fallback page is past the SQL listing's last page", async () => {
    const { store, search } = fakes({ kind: "unavailable", retryAfterSeconds: null });
    expect(
      await loadCatalogSearchPage(store, search, "en", { query: { ...empty, page: 5 } }),
    ).toEqual({ kind: "not_found" });
  });

  it("explains a selection the API refuses (a 400) instead of silently dropping it", async () => {
    const { store, search, listings } = fakes({ kind: "invalid", reason: "filter" });
    const page = await loadCatalogSearchPage(store, search, "en", {
      categorySlug: "tops",
      query: { ...empty, facets: ["opt.gone:x"] },
    });
    expect(page).toMatchObject({ kind: "invalid", reason: "filter" });
    expect(listings).toEqual([]);
  });

  it("does not fall back for an engine refusal or anything unexpected: it throws (ADR 0036 decision 6)", async () => {
    const { store, search, listings } = fakes(() =>
      Promise.reject(new Error("GET /store/search answered 500 internal_error")),
    );
    await expect(loadCatalogSearchPage(store, search, "en", { query: empty })).rejects.toThrow(
      /500/,
    );
    expect(listings).toEqual([]);
  });
});
