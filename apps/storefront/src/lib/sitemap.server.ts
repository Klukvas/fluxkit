import { defaultLocale, locales } from "@fluxkit/ui";
import { currentFeatures, loadEnabledFeatures } from "../features/enabled";
import { registeredFeatures } from "../features/registry";
import { featureData } from "../features/runtime.server";
import {
  buildSitemap,
  collectFeatureSitemapPages,
  collectSitemapProducts,
  type SitemapEntry,
} from "./sitemap";
import { publicOrigin } from "./public-url.server";
import { shopPagePaths } from "./shop-pages";
import { SITEMAP_REVALIDATE_SECONDS } from "./store-data";
import { storeData } from "./store-data.server";

/**
 * The pages of the enabled feature slices. Without any slice on disk (the template) the config is not read at all; with one, a
 * config that cannot be read now (or only a stale copy) fails the sitemap, like a refused product page.
 */
async function loadFeaturePages() {
  if (registeredFeatures.length === 0) return [];
  return collectFeatureSitemapPages(
    registeredFeatures,
    currentFeatures(await loadEnabledFeatures(storeData)),
    { locale: defaultLocale, data: (name) => featureData(name) },
  );
}

/**
 * The sitemap of the running app (server code only): categories and products read from the API with a 1 hour cache, and the
 * pages of the feature slices that `GET /store/config` lists as enabled (each slice reads its own, `StoreData.featureRead`).
 * The three reads run in parallel.
 */
export async function loadSitemap(): Promise<SitemapEntry[]> {
  const origin = await publicOrigin();
  const [categories, products, featurePages] = await Promise.all([
    storeData.listCategories(defaultLocale, { revalidateSeconds: SITEMAP_REVALIDATE_SECONDS }),
    collectSitemapProducts(storeData, defaultLocale),
    loadFeaturePages(),
  ]);
  if (!categories.ok) {
    throw new Error(`GET /store/categories for the sitemap answered ${categories.status}.`);
  }
  return buildSitemap({
    origin,
    locales,
    defaultLocale,
    categories: categories.data.items,
    products,
    shopPages: shopPagePaths(),
    featurePages,
  });
}
