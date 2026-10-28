import type { ProblemDetails } from "@fluxkit/api-client";
import { describe, expect, it, vi } from "vitest";
import type { HomeSection } from "../layout/home";
import {
  UnexpectedStoreResponseError,
  loadCatalogListing,
  loadHomeData,
  loadProductPage,
  loadShopExponent,
  loadShopMoney,
} from "./catalog-data";
import type { CatalogOutcome, StoreData } from "./store-data";
import { category, product, summary } from "./test-fixtures";

const config = {
  currency: "UAH",
  currencyExponent: 2,
  pricesIncludeTax: true,
  defaultLocale: "uk",
  locales: ["uk", "en"],
  emailDelivery: false,
  onlinePayment: false,
};

function problem(status: number, code: ProblemDetails["code"]): CatalogOutcome<never> {
  return {
    ok: false,
    status,
    problem: { type: "about:blank", title: "t", status, code, detail: "d" },
  };
}

function ok<T>(data: T): CatalogOutcome<T> {
  return { ok: true, data, stale: false };
}

function fakeData(overrides: Partial<StoreData> = {}): StoreData & {
  calls: { listProducts: unknown[][]; listCategories: unknown[][]; getProduct: unknown[][] };
} {
  const calls = {
    listProducts: [] as unknown[][],
    listCategories: [] as unknown[][],
    getProduct: [] as unknown[][],
  };
  return {
    calls,
    getConfig: async () => ok(config),
    listCategories: async (...args: unknown[]) => {
      calls.listCategories.push(args);
      return ok({ items: [category("clothing", [category("tops")]), category("books")] });
    },
    listProducts: async (...args: unknown[]) => {
      calls.listProducts.push(args);
      return ok({ items: [summary("a"), summary("b")], total: 2, limit: 24, offset: 0 });
    },
    getProduct: async (...args: unknown[]) => {
      calls.getProduct.push(args);
      return ok(product({ categories: [{ id: "c", slug: "tops", name: "Tops" }] }));
    },
    ...overrides,
  } as StoreData & { calls: typeof calls };
}

const homeSections: HomeSection[] = [
  { type: "hero", props: { titleKey: "a", descriptionKey: "b", ctaKey: "c", ctaHref: "/catalog" } },
  {
    type: "categoryTiles",
    props: { titleKey: "a", emptyTitleKey: "b", emptyDescriptionKey: "c", limit: 3 },
  },
  {
    type: "newProducts",
    props: {
      limit: 8,
      titleKey: "a",
      allKey: "d",
      emptyTitleKey: "b",
      emptyDescriptionKey: "c",
    },
  },
];

describe("loadHomeData", () => {
  it("asks for what the configured sections need, once each, with the section's limit", async () => {
    const data = fakeData();
    const result = await loadHomeData(data, "uk", homeSections);
    expect(data.calls.listProducts).toEqual([["uk", { limit: 8 }]]);
    expect(data.calls.listCategories).toEqual([["uk"]]);
    expect(result.exponent).toBe(2);
    expect(result.newProducts?.map((item) => item.slug)).toEqual(["a", "b"]);
    expect(result.categories?.map((node) => node.slug)).toEqual(["clothing", "books"]);
  });

  it("makes no request for a layout without data sections", async () => {
    const data = fakeData();
    const result = await loadHomeData(data, "en", [homeSections[0] as HomeSection]);
    expect(result).toEqual({});
    expect(data.calls.listProducts).toHaveLength(0);
    expect(data.calls.listCategories).toHaveLength(0);
  });

  it("fails loudly when the API refuses a request (no fake data)", async () => {
    const data = fakeData({ listProducts: async () => problem(400, "validation_failed") });
    await expect(loadHomeData(data, "uk", homeSections)).rejects.toBeInstanceOf(
      UnexpectedStoreResponseError,
    );
  });

  it("passes an outage through: the data layer's error reaches the route's error.tsx", async () => {
    const outage = new Error("StoreUnavailableError");
    const data = fakeData({
      listProducts: async () => {
        throw outage;
      },
    });
    await expect(loadHomeData(data, "uk", homeSections)).rejects.toBe(outage);
  });
});

describe("loadCatalogListing", () => {
  it("lists one page with limit 24, the offset of the page, the category and the brand", async () => {
    const data = fakeData({
      listProducts: vi.fn(async () =>
        ok({ items: [summary("a")], total: 60, limit: 24, offset: 24 }),
      ),
    });
    const result = await loadCatalogListing(data, "uk", {
      categorySlug: "tops",
      query: { page: 2, brand: "demo-brand" },
    });
    expect(data.listProducts).toHaveBeenCalledWith("uk", {
      limit: 24,
      offset: 24,
      category: "tops",
      brand: "demo-brand",
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.pageCount).toBe(3);
    expect(result.category?.slug).toBe("tops");
    expect(result.trail.map((node) => node.slug)).toEqual(["clothing", "tops"]);
    expect(result.brandName).toBe("§brand");
    expect(result.exponent).toBe(2);
  });

  it("sends neither category nor brand on the plain catalog, and asks for no categories", async () => {
    const data = fakeData();
    await loadCatalogListing(data, "en", { query: { page: 1, brand: null } });
    expect(data.calls.listProducts).toEqual([["en", { limit: 24, offset: 0 }]]);
    expect(data.calls.listCategories).toHaveLength(0);
  });

  it("is not found for an unknown category, before any product request", async () => {
    const data = fakeData();
    const result = await loadCatalogListing(data, "uk", {
      categorySlug: "missing",
      query: { page: 1, brand: null },
    });
    expect(result).toEqual({ kind: "not_found" });
    expect(data.calls.listProducts).toHaveLength(0);
  });

  it("is not found for a page past the last one (not the last page, not an empty list)", async () => {
    const data = fakeData({
      listProducts: async () => ok({ items: [], total: 30, limit: 24, offset: 48 }),
    });
    expect(await loadCatalogListing(data, "uk", { query: { page: 3, brand: null } })).toEqual({
      kind: "not_found",
    });
  });

  it("shows an empty first page as ok with zero pages (the page renders an empty state)", async () => {
    const data = fakeData({
      listProducts: async () => ok({ items: [], total: 0, limit: 24, offset: 0 }),
    });
    const result = await loadCatalogListing(data, "uk", { query: { page: 1, brand: "nothing" } });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.pageCount).toBe(0);
      expect(result.brandName).toBeNull();
    }
  });

  it("never calls the API with an offset above its limit", async () => {
    const data = fakeData();
    expect(await loadCatalogListing(data, "uk", { query: { page: 418, brand: null } })).toEqual({
      kind: "not_found",
    });
    expect(data.calls.listProducts).toHaveLength(0);
  });
});

describe("loadProductPage", () => {
  it("returns the product with the shop's exponent and the deepest category trail", async () => {
    const data = fakeData();
    const result = await loadProductPage(data, "uk", "demo-product");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.exponent).toBe(2);
    expect(result.trail.map((node) => node.slug)).toEqual(["clothing", "tops"]);
    expect(data.calls.getProduct).toEqual([["uk", "demo-product"]]);
  });

  it("is not found for the API's 404 (unknown, unpublished or without a sellable variant)", async () => {
    const data = fakeData({ getProduct: async () => problem(404, "not_found") });
    expect(await loadProductPage(data, "uk", "ghost")).toEqual({ kind: "not_found" });
  });

  it("is not found for a slug the API refuses as malformed (400)", async () => {
    const data = fakeData({ getProduct: async () => problem(400, "validation_failed") });
    expect(await loadProductPage(data, "uk", "x".repeat(200))).toEqual({ kind: "not_found" });
  });

  it("fails loudly on any other refusal", async () => {
    const data = fakeData({ getProduct: async () => problem(403, "forbidden") });
    await expect(loadProductPage(data, "uk", "demo")).rejects.toBeInstanceOf(
      UnexpectedStoreResponseError,
    );
  });
});

describe("loadShopExponent", () => {
  it("reads the currency digits from the cached shop config", async () => {
    expect(await loadShopExponent(fakeData())).toBe(2);
    expect(
      await loadShopExponent(
        fakeData({ getConfig: async () => ok({ ...config, currencyExponent: 0 }) }),
      ),
    ).toBe(0);
  });

  it("fails loudly (error.tsx) when the config is refused, instead of guessing digits", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      loadShopExponent(fakeData({ getConfig: async () => problem(500, "internal_error") })),
    ).rejects.toThrow(UnexpectedStoreResponseError);
  });
});

describe("loadShopMoney", () => {
  it("reads the shop currency and its digits from the cached shop config (the order pages)", async () => {
    expect(await loadShopMoney(fakeData())).toEqual({ currency: "UAH", exponent: 2 });
  });
});
