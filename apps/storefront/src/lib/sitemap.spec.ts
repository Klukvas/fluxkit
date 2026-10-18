import { describe, expect, it } from "vitest";
import type { CatalogOutcome, StoreData } from "./store-data";
import { SITEMAP_PRODUCT_PAGE_SIZE, buildSitemap, collectSitemapProducts } from "./sitemap";
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
