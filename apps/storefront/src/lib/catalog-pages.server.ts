import { cache } from "react";
import { homeSections } from "../layout/home";
import { loadCatalogListing, loadHomeData, loadProductPage } from "./catalog-data";
import { storeData } from "./store-data.server";

/**
 * The page loaders of the running app, memoized per request with React `cache`, so a page and its `generateMetadata` share
 * one load (and one set of API reads). Server code only.
 */

export const getHomeData = cache((locale: string) => loadHomeData(storeData, locale, homeSections));

export const getListing = cache(
  (locale: string, categorySlug: string | undefined, page: number, brand: string | null) =>
    loadCatalogListing(storeData, locale, {
      ...(categorySlug === undefined ? {} : { categorySlug }),
      query: { page, brand },
    }),
);

export const getProductPage = cache((locale: string, slug: string) =>
  loadProductPage(storeData, locale, slug),
);
