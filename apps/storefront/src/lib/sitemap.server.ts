import { defaultLocale, locales } from "@fluxkit/ui";
import { buildSitemap, collectSitemapProducts, type SitemapEntry } from "./sitemap";
import { publicOrigin } from "./public-url.server";
import { SITEMAP_REVALIDATE_SECONDS } from "./store-data";
import { storeData } from "./store-data.server";

/** The sitemap of the running app (server code only): categories and products read from the API with a 1 hour cache. */
export async function loadSitemap(): Promise<SitemapEntry[]> {
  const origin = await publicOrigin();
  const categories = await storeData.listCategories(defaultLocale, {
    revalidateSeconds: SITEMAP_REVALIDATE_SECONDS,
  });
  if (!categories.ok) {
    throw new Error(`GET /store/categories for the sitemap answered ${categories.status}.`);
  }
  const products = await collectSitemapProducts(storeData, defaultLocale);
  return buildSitemap({
    origin,
    locales,
    defaultLocale,
    categories: categories.data.items,
    products,
  });
}
