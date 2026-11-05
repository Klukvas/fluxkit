import type { HomeBanner, HomeBannerList, ProblemDetails } from "@fluxkit/api-client";
import { describe, expect, it, vi } from "vitest";
import type { AdminBannersSection, CategoriesSection, ProductRowSection } from "../config/home";
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
    listBanners: async () => ok({ items: [] }),
    ...overrides,
  } as unknown as StoreData;
  return { data, calls };
}

const banners: AdminBannersSection = {
  kind: "banners",
  source: "admin",
  id: "home-banners",
  titleKey: "t",
};

function storeBanner(id: string, overrides: Partial<HomeBanner> = {}): HomeBanner {
  return {
    id,
    layout: "card",
    title: `Title ${id}`,
    text: null,
    href: "/catalog",
    tone: "surface",
    image: {
      url: `https://media.example.com/${"a".repeat(32)}.webp`,
      width: 1280,
      height: 640,
      alt: null,
    },
    ...overrides,
  };
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

describe("loadHomeSection: banners of the admin (source admin)", () => {
  it("reads GET /store/banners once for the page's locale and keeps the checked banners in the API's order", async () => {
    const asked: unknown[][] = [];
    const { data } = fakeData({
      listBanners: async (...args: unknown[]) => {
        asked.push(args);
        return ok({
          items: [
            storeBanner("b1", { tone: "accent" }),
            storeBanner("b2", {
              layout: "image",
              title: null,
              text: null,
              image: { ...storeBanner("b2").image, alt: "Collection" },
            }),
          ],
        });
      },
    });
    const result = await loadHomeSection(data, "en", banners, {
      imageHosts: ["media.example.com"],
    });
    expect(asked).toEqual([["en"]]);
    expect(result.kind === "banners" && result.banners.map((banner) => banner.id)).toEqual([
      "b1",
      "b2",
    ]);
    expect(result.kind === "banners" && result.banners[0]?.link).toEqual({
      href: "/en/catalog",
      external: false,
    });
  });

  it("renders the picture URL the API resolved for the locale (it chooses the locale's own picture or the default)", async () => {
    const own = `https://media.example.com/${"e".repeat(32)}.webp`;
    const fallback = `https://media.example.com/${"d".repeat(32)}.webp`;
    const { data } = fakeData({
      listBanners: async (locale: string) =>
        ok({
          items: [
            storeBanner("b1", {
              image: { url: locale === "en" ? own : fallback, width: 1280, height: 640, alt: null },
            }),
          ],
        }),
    });
    const options = { imageHosts: ["media.example.com"] };
    const en = await loadHomeSection(data, "en", banners, options);
    const uk = await loadHomeSection(data, "uk", banners, options);
    expect(en.kind === "banners" && en.banners[0]?.picture.src).toBe(own);
    expect(uk.kind === "banners" && uk.banners[0]?.picture.src).toBe(fallback);
  });

  it("is empty when the shop has no live banner (the section is then hidden)", async () => {
    const { data } = fakeData();
    expect(await loadHomeSection(data, "uk", banners)).toEqual({ kind: "banners", banners: [] });
  });

  it("skips a bad banner, logs it, and keeps the others (never a page error)", async () => {
    const warn = vi.fn();
    const { data } = fakeData({
      listBanners: async () =>
        ok({ items: [storeBanner("bad", { href: "javascript:alert(1)" }), storeBanner("good")] }),
    });
    const result = await loadHomeSection(data, "uk", banners, {
      imageHosts: ["media.example.com"],
      warn,
    });
    expect(result.kind === "banners" && result.banners.map((banner) => banner.id)).toEqual([
      "good",
    ]);
    expect(warn).toHaveBeenCalledWith("Home banner bad is not shown: link_not_path_or_https.");
  });

  it("treats an answer without an items list as a response the page cannot handle", async () => {
    const { data } = fakeData({ listBanners: async () => ok({} as HomeBannerList) });
    const log = vi.fn();
    expect(await loadHomeSectionResult(data, "uk", banners, log)).toEqual({ status: "error" });
    expect(log.mock.calls[0]?.[1]).toBeInstanceOf(UnexpectedStoreResponseError);
  });

  it("turns an outage into the error state (the page then hides the section) and logs it in full", async () => {
    const outage = new StoreUnavailableError("GET /store/banners", new Error("ECONNREFUSED"));
    const { data } = fakeData({
      listBanners: async () => {
        throw outage;
      },
    });
    const log = vi.fn();
    expect(await loadHomeSectionResult(data, "uk", banners, log)).toEqual({ status: "error" });
    expect(log).toHaveBeenCalledWith('Home section "home-banners" could not be loaded.', outage);
  });

  it("turns a 404 of an older API (no banners route) into the error state too", async () => {
    const { data } = fakeData({ listBanners: async () => problem(404, "not_found") });
    const log = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await loadHomeSectionResult(data, "uk", banners, log)).toEqual({ status: "error" });
    consoleError.mockRestore();
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
