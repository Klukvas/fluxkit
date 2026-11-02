import type { ProblemDetails } from "@fluxkit/api-client";
import { describe, expect, it, vi } from "vitest";
import type { CategoriesSection, ProductRowSection } from "../config/home";
import { UnexpectedStoreResponseError } from "./catalog-data";
import { loadHomeSection, loadHomeSectionResult } from "./home-data";
import { StoreUnavailableError, type CatalogOutcome, type StoreData } from "./store-data";
import { category, summary } from "./test-fixtures";

const config = {
  currency: "UAH",
  currencyExponent: 2,
  pricesIncludeTax: true,
  defaultLocale: "uk",
  locales: ["uk", "en"],
  emailDelivery: false,
  onlinePayment: false,
  search: false,
};

function ok<T>(data: T): CatalogOutcome<T> {
  return { ok: true, data, stale: false };
}

function problem(status: number, code: ProblemDetails["code"]): CatalogOutcome<never> {
  return {
    ok: false,
    status,
    problem: { type: "about:blank", title: "t", status, code, detail: "d" },
  };
}

function fakeData(overrides: Partial<StoreData> = {}) {
  const calls = { listProducts: [] as unknown[][], listCategories: [] as unknown[][] };
  const data = {
    getConfig: async () => ok(config),
    listCategories: async (...args: unknown[]) => {
      calls.listCategories.push(args);
      return ok({
        items: [category("clothing", [category("tops")]), category("books"), category("tools")],
      });
    },
    listProducts: async (...args: unknown[]) => {
      calls.listProducts.push(args);
      return ok({ items: [summary("a"), summary("b")], total: 2, limit: 8, offset: 0 });
    },
    getProduct: async () => problem(404, "not_found"),
    ...overrides,
  } as unknown as StoreData;
  return { data, calls };
}

const categories: CategoriesSection = { kind: "categories", id: "c", titleKey: "t", limit: 2 };
const newest: ProductRowSection = {
  kind: "productRow",
  id: "p",
  titleKey: "t",
  limit: 8,
  source: { sort: "newest" },
};

describe("loadHomeSection", () => {
  it("reads the top-level categories once and keeps the section's limit", async () => {
    const { data, calls } = fakeData();
    const result = await loadHomeSection(data, "uk", categories);
    expect(calls.listCategories).toEqual([["uk"]]);
    expect(result.kind === "categories" && result.categories.map((node) => node.slug)).toEqual([
      "clothing",
      "books",
    ]);
  });

  it("reads the newest products with the section's limit and the shop's currency digits", async () => {
    const { data, calls } = fakeData();
    const result = await loadHomeSection(data, "en", newest);
    expect(calls.listProducts).toEqual([["en", { limit: 8 }]]);
    expect(result).toEqual({
      kind: "productRow",
      products: [summary("a"), summary("b")],
      exponent: 2,
    });
  });

  it("narrows a row to a category or a brand when the config says so", async () => {
    const { data, calls } = fakeData();
    await loadHomeSection(data, "uk", { ...newest, source: { sort: "newest", category: "tools" } });
    await loadHomeSection(data, "uk", {
      ...newest,
      limit: 4,
      source: { sort: "newest", brand: "acme" },
    });
    expect(calls.listProducts).toEqual([
      ["uk", { limit: 8, category: "tools" }],
      ["uk", { limit: 4, brand: "acme" }],
    ]);
  });
});

describe("loadHomeSectionResult", () => {
  it("returns the data of a section that loaded", async () => {
    const { data } = fakeData();
    const result = await loadHomeSectionResult(data, "uk", categories);
    expect(result.status).toBe("ok");
  });

  it("turns an outage into the section's error state and logs it in full", async () => {
    const outage = new StoreUnavailableError("GET /store/products", new Error("ECONNREFUSED"));
    const { data } = fakeData({
      listProducts: async () => {
        throw outage;
      },
    });
    const log = vi.fn();
    expect(await loadHomeSectionResult(data, "uk", newest, log)).toEqual({ status: "error" });
    expect(log).toHaveBeenCalledWith('Home section "p" could not be loaded.', outage);
  });

  it("turns a response the page cannot handle into the error state too (logged)", async () => {
    const { data } = fakeData({ listCategories: async () => problem(400, "validation_failed") });
    const log = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await loadHomeSectionResult(data, "uk", categories, log)).toEqual({ status: "error" });
    expect(log.mock.calls[0]?.[1]).toBeInstanceOf(UnexpectedStoreResponseError);
    consoleError.mockRestore();
  });

  it("throws any other error (a bug must reach the error page, not hide as a section state)", async () => {
    const bug = new TypeError("x is not a function");
    const { data } = fakeData({
      listCategories: async () => {
        throw bug;
      },
    });
    await expect(loadHomeSectionResult(data, "uk", categories, vi.fn())).rejects.toBe(bug);
  });
});
