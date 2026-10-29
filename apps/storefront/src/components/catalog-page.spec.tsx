import type { SearchResult } from "@fluxkit/api-client";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CategoryPage, {
  generateMetadata as categoryMetadata,
} from "../app/[locale]/(catalog)/c/[slug]/page";
import CatalogPage, {
  generateMetadata as catalogMetadata,
} from "../app/[locale]/(catalog)/catalog/page";
import type { SearchOutcome, SearchReadOptions } from "../lib/search-data";
import type { SearchQuery } from "../lib/search-query";
import { category, summary } from "../lib/test-fixtures";
import en from "../messages/en.json";
import { I18nProvider } from "./i18n-provider";

/*
 * The catalog and category ROUTES run as functions (search plan step 10a, rest: facets and sort through the index with the
 * SQL fallback). Next's `notFound` and `redirect` throw, the server reads are stubs. Pinned here: search off is the SQL
 * listing of before; search on reads `GET /store/search` once per view (never in `generateMetadata`), with the results
 * page's URL state on the page's own path; a category page filters by its id and does not offer the category facet; every
 * answer meaning "search cannot serve this now" falls back to the SQL listing WITH a notice.
 */

const reads = vi.hoisted(() => ({
  enabled: true,
  outcome: null as SearchOutcome | null,
  searched: [] as { query: SearchQuery; read: SearchReadOptions | undefined }[],
  listings: [] as unknown[][],
  sqlListings: [] as unknown[][],
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`);
  },
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/en/catalog",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../lib/search-data.server", () => ({
  getSearchEnabled: () => Promise.resolve(reads.enabled),
  searchData: {
    search: (_locale: string, query: SearchQuery, read?: SearchReadOptions) => {
      reads.searched.push({ query, read });
      return Promise.resolve(reads.outcome);
    },
  },
}));
vi.mock("../lib/store-data.server", async () => {
  const fixtures = await import("../lib/test-fixtures");
  const ok = <T,>(data: T) => ({ ok: true as const, data, stale: false });
  return {
    storeData: {
      getConfig: () =>
        Promise.resolve(
          ok({
            currency: "UAH",
            currencyExponent: 2,
            pricesIncludeTax: true,
            defaultLocale: "uk",
            locales: ["uk", "en"],
            emailDelivery: false,
            onlinePayment: false,
            search: true,
          }),
        ),
      listCategories: () =>
        Promise.resolve(
          ok({
            items: [fixtures.category("tools", [fixtures.category("screwdrivers")])],
          }),
        ),
      listProducts: (...args: unknown[]) => {
        reads.sqlListings.push(args);
        return Promise.resolve(
          ok({ items: [fixtures.summary("sql-item")], total: 30, limit: 24, offset: 0 }),
        );
      },
      getProduct: () => Promise.reject(new Error("not used")),
    },
  };
});
vi.mock("../lib/catalog-pages.server", () => ({
  getShopMoney: () => Promise.resolve({ currency: "UAH", exponent: 2 }),
  getListing: (...args: unknown[]) => {
    reads.listings.push(args);
    return Promise.resolve({
      kind: "ok",
      products: { items: [summary("old-item")], total: 1, limit: 24, offset: 0 },
      page: 1,
      pageCount: 1,
      category: args[1] === undefined ? null : category("tools"),
      trail: args[1] === undefined ? [] : [category("tools")],
      brandName: null,
      exponent: 2,
    });
  },
}));
vi.mock("../lib/image-hosts.server", () => ({ imageHosts: () => [] }));
vi.mock("../lib/public-url.server", () => ({
  publicOrigin: () => Promise.resolve("https://shop.example"),
}));

function results(overrides: Partial<SearchResult> = {}): SearchOutcome {
  return {
    kind: "results",
    result: {
      items: [summary("indexed-item", { title: "Indexed item" })],
      total: 1,
      page: 1,
      pageCount: 1,
      limit: 24,
      sort: "newest",
      relaxed: false,
      query: { normalized: "" },
      facets: [
        {
          key: "brand",
          kind: "slug",
          level: "product",
          label: null,
          counted: true,
          values: [{ code: "demo-brand", label: "Demo Brand", count: 1, selected: false }],
          range: null,
        },
        {
          key: "category",
          kind: "uuid",
          level: "product",
          label: null,
          counted: true,
          values: [
            { code: "category-screwdrivers", label: "Screwdrivers", count: 1, selected: false },
          ],
          range: null,
        },
        {
          key: "opt.size",
          kind: "code",
          level: "variant",
          label: "Size",
          counted: false,
          values: [{ code: "m", label: "M", count: null, selected: false }],
          range: null,
        },
      ],
      price: { min: 1000, max: 1000 },
      ...overrides,
    },
  };
}

type Params = Record<string, string | string[]>;

async function render(element: Promise<unknown>): Promise<string> {
  return renderToStaticMarkup(
    <I18nProvider locale="en" messages={en}>
      {(await element) as ReactElement}
    </I18nProvider>,
  );
}

function catalog(searchParams: Params): Promise<string> {
  return render(
    CatalogPage({
      params: Promise.resolve({ locale: "en" }),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

function categoryView(searchParams: Params, slug = "tools"): Promise<string> {
  return render(
    CategoryPage({
      params: Promise.resolve({ locale: "en", slug }),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

beforeEach(() => {
  reads.enabled = true;
  reads.outcome = results();
  reads.searched = [];
  reads.listings = [];
  reads.sqlListings = [];
});

describe("catalog routes with search off", () => {
  it("are the SQL listing of before: ?brand= and ?page=, no filter form, no search read", async () => {
    reads.enabled = false;
    const html = await catalog({ brand: "demo-brand" });
    expect(html).toContain("Title of old-item");
    expect(html).not.toContain(`aria-label="${en["search.filters.title"]}"`);
    expect(html).not.toContain(en["catalog.fallback.title"]);
    expect(reads.listings).toEqual([["en", undefined, 1, "demo-brand"]]);
    expect(reads.searched).toEqual([]);
    await expect(catalog({ page: "0" })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("the catalog route with search on", () => {
  it("lists through GET /store/search with the facet panel, the sort and the count", async () => {
    const html = await catalog({});
    expect(html).toContain("Indexed item");
    expect(html).toContain(`aria-label="${en["search.filters.title"]}"`);
    expect(html).toContain(en["search.sort.label"]);
    expect(html).toContain('name="f" value="opt.size:m"');
    // On the whole catalog the category is an ordinary facet.
    expect(html).toContain('value="category:category-screwdrivers"');
    expect(html).toContain("1 product");
    expect(reads.searched).toEqual([
      {
        query: { q: "", facets: [], price: null, sort: null, page: 1 },
        read: { cacheSeconds: 60 },
      },
    ]);
    expect(reads.listings).toEqual([]);
  });

  it("links pages, chips and 'clear' to its own path with the results page's URL state", async () => {
    reads.outcome = results({
      page: 1,
      pageCount: 3,
      total: 60,
      facets: [
        {
          key: "opt.size",
          kind: "code",
          level: "variant",
          label: "Size",
          counted: false,
          values: [{ code: "m", label: "M", count: null, selected: true }],
          range: null,
        },
      ],
    });
    const html = await catalog({ f: "opt.size:m", sort: "price_asc" });
    expect(html).toContain('href="/en/catalog?f=opt.size%3Am&amp;sort=price_asc&amp;page=2"');
    // The chip removes the size and keeps the sort; "clear" keeps the sort too.
    expect(html).toContain('href="/en/catalog?sort=price_asc"');
    expect(html).not.toContain("/en/search?");
    expect(reads.searched[0]?.read).toBeUndefined();
  });

  it("reads the list once per view: generateMetadata never searches", async () => {
    await catalogMetadata({
      params: Promise.resolve({ locale: "en" }),
      searchParams: Promise.resolve({ f: "opt.size:m" }),
    });
    expect(reads.searched).toEqual([]);
  });

  it("keeps ?brand= working as a brand facet, without a redirect", async () => {
    await catalog({ brand: "demo-brand" });
    expect(reads.searched[0]?.query.facets).toEqual(["brand:demo-brand"]);
  });

  it("redirects a non-canonical address to the short one on its own path, before it searches", async () => {
    await expect(catalog({ page: "1" })).rejects.toThrow("NEXT_REDIRECT /en/catalog");
    await expect(catalog({ priceMin: "12.50", priceMax: "" })).rejects.toThrow(
      "NEXT_REDIRECT /en/catalog?price=1250..",
    );
    expect(reads.searched).toEqual([]);
  });

  it("is a real 404 for words, a malformed parameter or a page past the last one", async () => {
    await expect(catalog({ q: "shirt" })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(catalog({ f: "nocolon" })).rejects.toThrow("NEXT_NOT_FOUND");
    reads.outcome = results({ page: 2, pageCount: 1 });
    await expect(catalog({ page: "2" })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  for (const outcome of [
    { kind: "unavailable", retryAfterSeconds: 30 },
    { kind: "rate_limited", retryAfterSeconds: 5 },
  ] as const) {
    it(`falls back to the SQL listing and SAYS so when search is ${outcome.kind}`, async () => {
      reads.outcome = outcome;
      const html = await catalog({ f: ["opt.size:m", "brand:demo-brand"], sort: "price_asc" });
      expect(html).toContain("Title of sql-item");
      expect(html).toContain(en["catalog.fallback.title"]);
      expect(html).toContain(en["catalog.fallback.dropped"]);
      // The brand is applied by the SQL listing and shown as before.
      expect(reads.sqlListings).toEqual([["en", { limit: 24, offset: 0, brand: "demo-brand" }]]);
      // Try again and the pages keep the address, so the filters come back with search.
      expect(html).toContain(
        'href="/en/catalog?f=opt.size%3Am&amp;f=brand%3Ademo-brand&amp;sort=price_asc"',
      );
      expect(html).toContain(
        'href="/en/catalog?f=opt.size%3Am&amp;f=brand%3Ademo-brand&amp;sort=price_asc&amp;page=2"',
      );
      expect(html).not.toContain(`aria-label="${en["search.filters.title"]}"`);
    });
  }

  it("says the list is unfiltered even when the address had no filters", async () => {
    reads.outcome = { kind: "unavailable", retryAfterSeconds: null };
    const html = await catalog({});
    expect(html).toContain(en["catalog.fallback.title"]);
    expect(html).toContain(en["catalog.fallback.description"]);
  });

  it("explains a refused selection with a link that clears it on its own path, never a silent list", async () => {
    reads.outcome = { kind: "invalid", reason: "filter" };
    const html = await catalog({ f: "opt.gone:x" });
    expect(html).toContain(en["search.invalid.title"]);
    expect(html).toContain('href="/en/catalog"');
    expect(reads.sqlListings).toEqual([]);
  });

  it("is noindex with the plain list as canonical when filtered or sorted", async () => {
    const metadata = await catalogMetadata({
      params: Promise.resolve({ locale: "en" }),
      searchParams: Promise.resolve({ sort: "price_asc" }),
    });
    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(metadata.alternates?.canonical).toBe("https://shop.example/en/catalog");
    const plain = await catalogMetadata({
      params: Promise.resolve({ locale: "en" }),
      searchParams: Promise.resolve({}),
    });
    expect(plain.robots).toBeUndefined();
  });
});

describe("the category route with search on", () => {
  it("filters by the category's id and does not offer the category facet (its path is the category)", async () => {
    const html = await categoryView({});
    expect(reads.searched[0]?.query.facets).toEqual(["category:category-tools"]);
    expect(html).toContain("Indexed item");
    expect(html).not.toContain('value="category:');
    expect(html).toContain('name="f" value="brand:demo-brand"');
    // Subcategories stay as links.
    expect(html).toContain('href="/en/c/screwdrivers"');
  });

  it("is a real 404 for an unknown category or a category facet in the address", async () => {
    await expect(categoryView({}, "nope")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(categoryView({ f: "category:category-screwdrivers" })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(reads.searched).toEqual([]);
  });

  it("falls back to the SQL listing of the category with the notice", async () => {
    reads.outcome = { kind: "unavailable", retryAfterSeconds: null };
    const html = await categoryView({});
    expect(html).toContain(en["catalog.fallback.title"]);
    expect(reads.sqlListings).toEqual([["en", { limit: 24, offset: 0, category: "tools" }]]);
  });

  it("keeps the category's own canonical and metadata", async () => {
    const metadata = await categoryMetadata({
      params: Promise.resolve({ locale: "en", slug: "tools" }),
      searchParams: Promise.resolve({ f: "opt.size:m" }),
    });
    expect(metadata.alternates?.canonical).toBe("https://shop.example/en/c/tools");
    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(reads.searched).toEqual([]);
  });
});
