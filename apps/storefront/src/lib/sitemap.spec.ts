import { describe, expect, it } from "vitest";
import type { CatalogOutcome, StoreData } from "./store-data";
import { feature as fixtureFeature } from "../features/fixtures/app/[locale]/(feature-notebook)/_feature/feature";
import type { FeatureData, RegisteredFeature, StorefrontFeature } from "../features/types";
import {
  SITEMAP_PRODUCT_PAGE_SIZE,
  buildSitemap,
  collectFeatureSitemapPages,
  collectSitemapProducts,
} from "./sitemap";
import { category, summary } from "./test-fixtures";

function ok<T>(data: T): CatalogOutcome<T> {
  return { ok: true, data, stale: false };
}

/** A catalog of `total` products; each call returns the slice the API would. */
function catalogOf(total: number) {
  const calls: {
    offset: number | undefined;
    limit: number | undefined;
    seconds: number | undefined;
  }[] = [];
  const data = {
    listProducts: async (
      _locale: string,
      query: { limit?: number; offset?: number } = {},
      read: { revalidateSeconds?: number } = {},
    ) => {
      calls.push({ offset: query.offset, limit: query.limit, seconds: read.revalidateSeconds });
      const offset = query.offset ?? 0;
      const limit = query.limit ?? 24;
      const items = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) =>
        summary(`p${offset + i}`, {
          publishedAt: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
        }),
      );
      return ok({ items, total, limit, offset });
    },
  } as unknown as StoreData;
  return { data, calls };
}

describe("collectSitemapProducts", () => {
  it("pages through the catalog 100 at a time with the one-hour cache and keeps the order", async () => {
    const { data, calls } = catalogOf(250);
    const products = await collectSitemapProducts(data, "uk");
    expect(products).toHaveLength(250);
    expect(products.map((product) => product.slug).slice(0, 3)).toEqual(["p0", "p1", "p2"]);
    expect(products[249]?.slug).toBe("p249");
    expect(SITEMAP_PRODUCT_PAGE_SIZE).toBe(100);
    expect(calls.map((call) => call.offset).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      0, 100, 200,
    ]);
    for (const call of calls) {
      expect(call.limit).toBe(100);
      expect(call.seconds).toBe(3600);
    }
  });

  it("makes one request for a small catalog and none beyond the API's offset cap", async () => {
    const small = catalogOf(5);
    expect(await collectSitemapProducts(small.data, "uk")).toHaveLength(5);
    expect(small.calls).toHaveLength(1);

    const huge = catalogOf(25_000);
    const products = await collectSitemapProducts(huge.data, "uk");
    // offsets 0..10 000 step 100 = 101 pages: at most 10 100 products are reachable (API gap 8).
    expect(huge.calls).toHaveLength(101);
    expect(Math.max(...huge.calls.map((call) => call.offset ?? 0))).toBe(10_000);
    expect(products).toHaveLength(10_100);
  });

  it("is empty for an empty catalog", async () => {
    expect(await collectSitemapProducts(catalogOf(0).data, "uk")).toEqual([]);
  });

  it("fails loudly when the API refuses a page (a sitemap with silently missing products is worse)", async () => {
    const data = {
      listProducts: async () => ({
        ok: false,
        status: 400,
        problem: {
          type: "about:blank",
          title: "t",
          status: 400,
          code: "validation_failed",
          detail: "d",
        },
      }),
    } as unknown as StoreData;
    await expect(collectSitemapProducts(data, "uk")).rejects.toThrow(/400/);
  });
});

describe("buildSitemap", () => {
  const input = {
    origin: "https://shop.example",
    locales: ["uk", "en"],
    defaultLocale: "uk",
    categories: [category("clothing", [category("tops")]), category("books")],
    products: [
      { slug: "demo-shirt", publishedAt: "2026-03-01T10:00:00.000Z" },
      { slug: "demo-mug", publishedAt: "2026-04-02T10:00:00.000Z" },
    ],
  };

  const entries = buildSitemap(input);
  const urls = entries.map((entry) => entry.url);

  it("lists home, catalog, every category at any depth and every product, in both locales", () => {
    expect(urls).toEqual(
      expect.arrayContaining([
        "https://shop.example/uk",
        "https://shop.example/en",
        "https://shop.example/uk/catalog",
        "https://shop.example/en/catalog",
        "https://shop.example/uk/c/clothing",
        "https://shop.example/en/c/tops",
        "https://shop.example/uk/c/books",
        "https://shop.example/uk/p/demo-shirt",
        "https://shop.example/en/p/demo-mug",
      ]),
    );
    expect(entries).toHaveLength((1 + 1 + 3 + 2) * 2);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("uses publishedAt as lastModified for products only", () => {
    const shirt = entries.find((entry) => entry.url === "https://shop.example/uk/p/demo-shirt");
    expect(shirt?.lastModified).toBe("2026-03-01T10:00:00.000Z");
    const home = entries.find((entry) => entry.url === "https://shop.example/uk");
    expect(home?.lastModified).toBeUndefined();
  });

  it("links the locale variants of each URL, with x-default", () => {
    const shirt = entries.find((entry) => entry.url === "https://shop.example/en/p/demo-shirt");
    expect(shirt?.alternates.languages).toEqual({
      uk: "https://shop.example/uk/p/demo-shirt",
      en: "https://shop.example/en/p/demo-shirt",
      "x-default": "https://shop.example/uk/p/demo-shirt",
    });
  });

  it("encodes slugs and never lists a filtered or paged URL", () => {
    const odd = buildSitemap({
      ...input,
      products: [{ slug: "a b", publishedAt: "2026-03-01T10:00:00.000Z" }],
    });
    expect(odd.some((entry) => entry.url === "https://shop.example/uk/p/a%20b")).toBe(true);
    for (const entry of entries) expect(entry.url).not.toMatch(/[?#]/);
  });

  it("stays under the 50 000 URLs a sitemap file may hold at the API's cap", () => {
    const products = Array.from({ length: 10_100 }, (_, i) => ({
      slug: `p${i}`,
      publishedAt: "2026-03-01T10:00:00.000Z",
    }));
    expect(buildSitemap({ ...input, products }).length).toBeLessThan(50_000);
  });
});

describe("feature pages in the sitemap (plan 2026-11-13-blog.md, section 9)", () => {
  const atlas: StorefrontFeature = {
    ...fixtureFeature,
    name: "atlas",
    sitemap: async ({ locale, data }) => {
      const outcome = await data.read<string[]>("GET /store/atlas/maps", async () => ({
        ok: true,
        status: 200,
        data: [`maps-${locale}`],
      }));
      if (!outcome.ok) throw new Error("refused");
      return outcome.data.map((slug) => ({ path: `/atlas/${slug}`, lastModified: "2026-11-01" }));
    },
  };
  /** A registry entry of a manifest whose pages live under `/<segment>`. */
  const entry = (feature: StorefrontFeature, segment = feature.name): RegisteredFeature => ({
    folder: feature.name,
    segments: [segment],
    feature,
  });
  /** Feature data that answers every read with what the call gives, recording the feature it was asked for. */
  function dataOf(asked: string[]) {
    return (feature: string): FeatureData => ({
      read: async (_operation, call) => {
        asked.push(feature);
        const result = await call({
          baseUrl: "http://api.internal:3000",
          fetch: async () => new Response(null),
          options: {},
        });
        return result.ok
          ? { ok: true, data: result.data, stale: false }
          : { ok: false, status: result.status, problem: result.problem };
      },
    });
  }

  it("asks only the enabled slices, in registry order, through their own reads", async () => {
    const asked: string[] = [];
    const pages = await collectFeatureSitemapPages(
      [entry(atlas), entry(fixtureFeature)],
      ["notebook", "atlas"],
      {
        locale: "uk",
        data: dataOf(asked),
      },
    );
    expect(pages).toEqual([
      { path: "/atlas/maps-uk", lastModified: "2026-11-01" },
      { path: "/notebook" },
    ]);
    expect(asked).toEqual(["atlas"]);
    expect(
      await collectFeatureSitemapPages([entry(atlas), entry(fixtureFeature)], [], {
        locale: "uk",
        data: dataOf([]),
      }),
    ).toEqual([]);
  });

  it("fails loudly on a refused read and on a path that is not under one of the slice's own pages", async () => {
    const refusing: StorefrontFeature = {
      ...fixtureFeature,
      sitemap: async () => {
        throw new Error("GET /store/notebook/pages answered 500");
      },
    };
    await expect(
      collectFeatureSitemapPages([entry(refusing)], ["notebook"], {
        locale: "uk",
        data: dataOf([]),
      }),
    ).rejects.toThrow(/answered 500/);
    for (const path of [
      "https://example.com/x",
      "notebook",
      "/",
      "/notebook/../b",
      "/notebook?page=2",
      "/notebook/a b",
      "/catalog",
    ]) {
      const odd: StorefrontFeature = { ...fixtureFeature, sitemap: async () => [{ path }] };
      await expect(
        collectFeatureSitemapPages([entry(odd)], ["notebook"], { locale: "uk", data: dataOf([]) }),
        path,
      ).rejects.toThrow(`The sitemap of feature "notebook" lists "${path}"`);
    }
  });

  it("lists the feature pages after the shop pages, in every locale with alternates, and nothing without them", () => {
    const input = {
      origin: "https://shop.example",
      locales: ["uk", "en"],
      defaultLocale: "uk",
      categories: [],
      products: [],
      shopPages: ["/about"],
    };
    const without = buildSitemap(input);
    const urls = buildSitemap({
      ...input,
      featurePages: [{ path: "/notebook", lastModified: "2026-11-01" }],
    });
    expect(buildSitemap({ ...input, featurePages: [] })).toEqual(without);
    expect(urls.map((entry) => entry.url)).toEqual([
      "https://shop.example/uk",
      "https://shop.example/en",
      "https://shop.example/uk/catalog",
      "https://shop.example/en/catalog",
      "https://shop.example/uk/about",
      "https://shop.example/en/about",
      "https://shop.example/uk/notebook",
      "https://shop.example/en/notebook",
    ]);
    expect(urls[6]).toEqual({
      url: "https://shop.example/uk/notebook",
      lastModified: "2026-11-01",
      alternates: {
        languages: {
          uk: "https://shop.example/uk/notebook",
          en: "https://shop.example/en/notebook",
          "x-default": "https://shop.example/uk/notebook",
        },
      },
    });
  });
});
