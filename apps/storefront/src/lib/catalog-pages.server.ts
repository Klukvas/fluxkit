import { cache } from "react";
import type { HomeDataSection } from "../config/home";
import {
  loadCatalogListing,
  loadEmailDelivery,
  loadOnlinePayment,
  loadProductPage,
  loadShopExponent,
  loadShopMoney,
} from "./catalog-data";
import { loadHomeSectionResult } from "./home-data";
import { storeData } from "./store-data.server";

/**
 * The page loaders of the running app, memoized per request with React `cache`, so a page and its `generateMetadata` share
 * one load (and one set of API reads). Server code only.
 */

/** One data section of the home page (`config/home.ts`); an outage is the section's error state, not the page's. */
export const getHomeSection = cache((locale: string, section: HomeDataSection) =>
  loadHomeSectionResult(storeData, locale, section),
);

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

/** The shop's currency digits, for the cart page's client component (it formats the API's amounts in the browser). */
export const getShopExponent = cache(() => loadShopExponent(storeData));

/** The shop currency and its digits, for the order pages (an order may be in an older currency). */
export const getShopMoney = cache(() => loadShopMoney(storeData));

/** Whether the shop has an email provider: the pages of the emailed links and their entry points depend on it. */
export const getEmailDelivery = cache(() => loadEmailDelivery(storeData));

/** Whether the shop takes payments online: the checkout wording and the pay button of the order pages depend on it. */
export const getOnlinePayment = cache(() => loadOnlinePayment(storeData));
