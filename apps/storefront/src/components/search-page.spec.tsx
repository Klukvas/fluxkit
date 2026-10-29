import type { SearchResult } from "@fluxkit/api-client";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SearchPage from "../app/[locale]/(catalog)/search/page";
import type { SearchOutcome } from "../lib/search-data";
import { summary } from "../lib/test-fixtures";
import en from "../messages/en.json";
import { I18nProvider } from "./i18n-provider";

/*
 * The results ROUTE (`app/[locale]/(catalog)/search/page.tsx`) run as a function, with Next's `notFound` and `redirect`
 * replaced by throws and the server reads by stubs (search UI review F3 and F5): the order of its decisions (search off,
 * a malformed address, a hand-made address, a refused form box, a page past the last one) is pinned here, not only by
 * the browser suite.
 */

const reads = vi.hoisted(() => ({
  enabled: true,
  outcome: null as SearchOutcome | null,
  searched: [] as unknown[],
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`);
  },
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/en/search",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../lib/search-data.server", () => ({
  getSearchEnabled: () => Promise.resolve(reads.enabled),
  searchData: {
    search: (_locale: string, query: unknown) => {
      reads.searched.push(query);
      return Promise.resolve(reads.outcome);
    },
  },
}));
vi.mock("../lib/catalog-pages.server", () => ({
  getShopMoney: () => Promise.resolve({ currency: "UAH", exponent: 2 }),
}));
vi.mock("../lib/image-hosts.server", () => ({ imageHosts: () => [] }));
vi.mock("../lib/public-url.server", () => ({
  publicOrigin: () => Promise.resolve("https://shop.example"),
}));

function results(overrides: Partial<SearchResult> = {}): SearchOutcome {
  return {
    kind: "results",
    result: {
      items: [summary("lamp", { title: "Lamp" })],
      total: 1,
      page: 1,
      pageCount: 1,
      limit: 24,
      sort: "relevance",
      relaxed: false,
      query: { normalized: "lamp" },
      facets: [],
      price: { min: 1000, max: 1000 },
      ...overrides,
    },
  };
}

async function visit(searchParams: Record<string, string | string[]>): Promise<string> {
  const element = (await SearchPage({
    params: Promise.resolve({ locale: "en" }),
    searchParams: Promise.resolve(searchParams),
  })) as ReactElement;
  return renderToStaticMarkup(
    <I18nProvider locale="en" messages={en}>
      {element}
    </I18nProvider>,
  );
}

beforeEach(() => {
  reads.enabled = true;
  reads.outcome = results();
  reads.searched = [];
});

describe("the results route", () => {
  it("renders a canonical address with its results", async () => {
    const html = await visit({ q: "lamp" });
    expect(html).toContain("Lamp");
    expect(reads.searched).toHaveLength(1);
  });

  it("is a real 404 when search is off, before it reads the address", async () => {
    reads.enabled = false;
    await expect(visit({ q: "lamp", page: "0" })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(reads.searched).toEqual([]);
  });

  it("is a real 404 for a malformed shared address, and searches nothing", async () => {
    await expect(visit({ q: "lamp", price: "abc" })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(visit({ q: "lamp", f: "brand:a b" })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(reads.searched).toEqual([]);
  });

  it("redirects a hand-made address (a script-less form submit) to the short one, before it searches", async () => {
    await expect(
      visit({ q: "lamp", priceMin: "12.50", priceMax: "", sort: "", page: "1" }),
    ).rejects.toThrow("NEXT_REDIRECT /en/search?q=lamp&price=1250..");
    await expect(visit({ q: "lamp", page: "1" })).rejects.toThrow(
      "NEXT_REDIRECT /en/search?q=lamp",
    );
    expect(reads.searched).toEqual([]);
  });

  it("shows the form's 'Check the filters' state for a refused box of a script-less submit, with the rest searched (review F3)", async () => {
    const html = await visit({ q: "lamp", priceMin: "12.505", priceMax: "" });
    expect(html).toContain(en["searchForm.error.title"]);
    expect(html).toContain(en["searchForm.error.priceMin"]);
    expect(html).toContain("Lamp");
    expect(reads.searched).toEqual([{ q: "lamp", facets: [], price: null, sort: null, page: 1 }]);
    const reversed = await visit({ q: "lamp", priceMin: "20", priceMax: "10" });
    expect(reversed).toContain(en["searchForm.error.priceOrder"]);
  });

  it("says the same when the rest cannot be searched (a limit), not a bare 404", async () => {
    reads.outcome = { kind: "rate_limited", retryAfterSeconds: 5 };
    const html = await visit({ q: "lamp", "rmin.attr.length": "abc" });
    expect(html).toContain(en["searchForm.error.title"]);
    expect(html).toContain(en["searchForm.error.range"]);
    expect(html).toContain(en["search.rateLimited.title"]);
  });

  it("is a real 404 for a page past the last one, and not for page 1 of nothing", async () => {
    reads.outcome = results({ page: 2, pageCount: 1 });
    await expect(visit({ q: "lamp", page: "2" })).rejects.toThrow("NEXT_NOT_FOUND");
    reads.outcome = results({ items: [], total: 0, pageCount: 0 });
    expect(await visit({ q: "lamp" })).toContain(en["search.empty.title"]);
    reads.outcome = results({ page: 2, pageCount: 2 });
    expect(await visit({ q: "lamp", page: "2" })).toContain("Lamp");
  });

  it("is a real 404 when the API says search is off", async () => {
    reads.outcome = { kind: "disabled" };
    await expect(visit({ q: "lamp" })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
