import type { CategoryNode } from "@fluxkit/api-client";
import { MAX_API_OFFSET } from "./catalog-query";
import { languageAlternates } from "./seo";
import { SITEMAP_REVALIDATE_SECONDS, type StoreData } from "./store-data";

/** Products per API request while building the sitemap (the API's maximum `limit`). */
export const SITEMAP_PRODUCT_PAGE_SIZE = 100;

/** Pages fetched in parallel after the first one. */
const PARALLEL_PAGES = 8;

export interface SitemapProduct {
  slug: string;
  publishedAt: string;
}

/**
 * Every listed product, 100 per request, newest first, up to the API's offset cap (offset 10 000 + 100 = 10 100 products;
 * API gap 8). The first page tells the total, the rest run in small parallel batches. Each page is a 1 hour data cache
 * entry. A refused page throws (via `StoreData` or here): a sitemap that silently lacks products would hide them from search.
 */
export async function collectSitemapProducts(
  data: StoreData,
  locale: string,
): Promise<SitemapProduct[]> {
  async function page(offset: number) {
    const outcome = await data.listProducts(
      locale,
      { limit: SITEMAP_PRODUCT_PAGE_SIZE, offset },
      { revalidateSeconds: SITEMAP_REVALIDATE_SECONDS },
    );
    if (!outcome.ok) {
      throw new Error(
        `GET /store/products for the sitemap answered ${outcome.status} ${outcome.problem.code}.`,
      );
    }
    return outcome.data;
  }

  const first = await page(0);
  const lastOffset = Math.min(
    Math.floor(Math.max(first.total - 1, 0) / SITEMAP_PRODUCT_PAGE_SIZE) *
      SITEMAP_PRODUCT_PAGE_SIZE,
    MAX_API_OFFSET,
  );
  const offsets: number[] = [];
  for (
    let offset = SITEMAP_PRODUCT_PAGE_SIZE;
    offset <= lastOffset;
    offset += SITEMAP_PRODUCT_PAGE_SIZE
  ) {
    offsets.push(offset);
  }
  const pages = [first];
  for (let start = 0; start < offsets.length; start += PARALLEL_PAGES) {
    pages.push(...(await Promise.all(offsets.slice(start, start + PARALLEL_PAGES).map(page))));
  }
  return pages.flatMap((entry) =>
    entry.items.map((item) => ({ slug: item.slug, publishedAt: item.publishedAt })),
  );
}

export interface SitemapEntry {
  url: string;
  lastModified?: string;
  alternates: { languages: Record<string, string> };
}

function flatten(tree: readonly CategoryNode[]): string[] {
  return tree.flatMap((node) => [node.slug, ...flatten(node.children)]);
}

export interface BuildSitemapInput {
  origin: string;
  locales: readonly string[];
  defaultLocale: string;
  categories: readonly CategoryNode[];
  products: readonly SitemapProduct[];
}

/** Home, catalog, categories and products, once per locale, each linking its other-locale variants. */
export function buildSitemap(input: BuildSitemapInput): SitemapEntry[] {
  const pages: { path: string; lastModified?: string }[] = [
    { path: "" },
    { path: "/catalog" },
    ...flatten(input.categories).map((slug) => ({ path: `/c/${encodeURIComponent(slug)}` })),
    ...input.products.map((product) => ({
      path: `/p/${encodeURIComponent(product.slug)}`,
      lastModified: product.publishedAt,
    })),
  ];
  return pages.flatMap((page) =>
    input.locales.map((locale) => {
      const { canonical, languages } = languageAlternates({
        origin: input.origin,
        locale,
        locales: input.locales,
        defaultLocale: input.defaultLocale,
        path: page.path,
      });
      return {
        url: canonical,
        ...(page.lastModified === undefined ? {} : { lastModified: page.lastModified }),
        alternates: { languages },
      };
    }),
  );
}
