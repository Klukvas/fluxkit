import type { CategoryNode, ProductSummary } from "@fluxkit/api-client";
import type { CategoriesSection, HomeDataSection, ProductRowSection } from "../config/home";
import { UnexpectedStoreResponseError, unwrap } from "./catalog-data";
import { StoreUnavailableError, type StoreData } from "./store-data";

/**
 * What a data section of the home page (`config/home.ts`) shows, one load per section, all through `StoreData` (the 60 s
 * data cache in the app, a fake in tests). The page starts every section's load at once and streams each into its own
 * boundary, so a slow or failed section never holds up the hero or the others.
 */

export type HomeSectionData =
  | { kind: "categories"; categories: CategoryNode[] }
  | { kind: "productRow"; products: ProductSummary[]; exponent: number };

export type HomeSectionResult = { status: "ok"; data: HomeSectionData } | { status: "error" };

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

export function loadHomeSection(
  data: StoreData,
  locale: string,
  section: HomeDataSection,
): Promise<HomeSectionData> {
  switch (section.kind) {
    case "categories":
      return loadCategories(data, locale, section);
    case "productRow":
      return loadProductRow(data, locale, section);
  }
}

/**
 * The section's data, or `error` when the store could not answer (an outage with no cached answer, or a response this page
 * does not handle): logged in full, and the section shows a short error while the rest of the page renders. Any other
 * error is a bug and is thrown (the route's error page).
 */
export async function loadHomeSectionResult(
  data: StoreData,
  locale: string,
  section: HomeDataSection,
  log: (message: string, error: unknown) => void = console.error,
): Promise<HomeSectionResult> {
  try {
    return { status: "ok", data: await loadHomeSection(data, locale, section) };
  } catch (error) {
    if (error instanceof StoreUnavailableError || error instanceof UnexpectedStoreResponseError) {
      log(`Home section "${section.id}" could not be loaded.`, error);
      return { status: "error" };
    }
    throw error;
  }
}
