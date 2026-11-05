import type { CategoryNode, ProductSummary } from "@fluxkit/api-client";
import { isLocale } from "@fluxkit/ui";
import type { CategoriesSection, HomeDataSection, ProductRowSection } from "../config/home";
import { UnexpectedStoreResponseError, unwrap } from "./catalog-data";
import { storeBannerViews, type StoreBannerView } from "./home-banners";
import { StoreUnavailableError, type StoreData } from "./store-data";

/**
 * What a data section of the home page (`config/home.ts`) shows, one load per section, all through `StoreData` (the 60 s
 * data cache in the app, a fake in tests). The page starts every section's load at once; the category tiles and product rows
 * stream into their own boundaries, so a slow or failed section never holds up the hero or the others.
 */

export type HomeSectionData =
  | { kind: "categories"; categories: CategoryNode[] }
  | { kind: "productRow"; products: ProductSummary[]; exponent: number }
  | { kind: "banners"; banners: StoreBannerView[] };

export type HomeSectionResult = { status: "ok"; data: HomeSectionData } | { status: "error" };

export interface HomeLoadOptions {
  /** Hosts `next/image` may load from (`STOREFRONT_IMAGE_HOSTS`): a banner picture elsewhere gets the placeholder. */
  imageHosts?: readonly string[];
  /** Where a skipped banner is reported; `console.warn` by default. */
  warn?: (message: string) => void;
}

async function loadCategories(
  data: StoreData,
  locale: string,
  section: CategoriesSection,
): Promise<HomeSectionData> {
  const tree = unwrap("GET /store/categories", await data.listCategories(locale)).items;
  return { kind: "categories", categories: tree.slice(0, section.limit) };
}

async function loadProductRow(
  data: StoreData,
  locale: string,
  section: ProductRowSection,
): Promise<HomeSectionData> {
  const { category, brand } = section.source;
  const [list, config] = await Promise.all([
    // The store API lists the newest first (`publishedAt` descending): `sort: "newest"` needs no parameter.
    data.listProducts(locale, {
      limit: section.limit,
      ...(category === undefined ? {} : { category }),
      ...(brand === undefined ? {} : { brand }),
    }),
    data.getConfig(),
  ]);
  return {
    kind: "productRow",
    products: unwrap("GET /store/products", list).items,
    exponent: unwrap("GET /store/config", config).currencyExponent,
  };
}

async function loadBanners(
  data: StoreData,
  locale: string,
  options: HomeLoadOptions,
): Promise<HomeSectionData> {
  if (!isLocale(locale)) throw new RangeError(`"${locale}" is not a storefront locale.`);
  const answer = unwrap("GET /store/banners", await data.listBanners(locale));
  if (!Array.isArray(answer.items)) {
    // Not the shape of the contract (an older or a foreign API): the section's error state, logged like any other.
    throw new UnexpectedStoreResponseError("GET /store/banners", 200, "unexpected_shape");
  }
  return {
    kind: "banners",
    banners: storeBannerViews(answer.items, locale, options.imageHosts ?? [], options.warn),
  };
}

export function loadHomeSection(
  data: StoreData,
  locale: string,
  section: HomeDataSection,
  options: HomeLoadOptions = {},
): Promise<HomeSectionData> {
  switch (section.kind) {
    case "categories":
      return loadCategories(data, locale, section);
    case "productRow":
      return loadProductRow(data, locale, section);
    case "banners":
      return loadBanners(data, locale, options);
  }
}

/**
 * The section's data, or `error` when the store could not answer (an outage with no cached answer, or a response this page
 * does not handle): logged in full, and the section shows a short error (banners: nothing) while the rest of the page
 * renders. Any other error is a bug and is thrown (the route's error page).
 */
export async function loadHomeSectionResult(
  data: StoreData,
  locale: string,
  section: HomeDataSection,
  log: (message: string, error: unknown) => void = console.error,
  options: HomeLoadOptions = {},
): Promise<HomeSectionResult> {
  try {
    return { status: "ok", data: await loadHomeSection(data, locale, section, options) };
  } catch (error) {
    if (error instanceof StoreUnavailableError || error instanceof UnexpectedStoreResponseError) {
      log(`Home section "${section.id}" could not be loaded.`, error);
      return { status: "error" };
    }
    throw error;
  }
}
