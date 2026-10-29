import type { CategoryNode, ProductDetail, ProductList, ProductSummary } from "@fluxkit/api-client";
import type { HomeSection } from "../layout/home";
import {
  CATALOG_PAGE_SIZE,
  isPageInRange,
  offsetForPage,
  pageCountFor,
  type CatalogQuery,
  maxPage,
} from "./catalog-query";
import { categoryTrail, deepestTrail } from "./category-trail";
import type { ShopMoney } from "./order-model";
import type { CatalogOutcome, StoreData } from "./store-data";

/**
 * What each catalog route needs from the API, loaded through `StoreData` (so tests use a fake and production uses the
 * cached server data layer). A page decides between "render" and `notFound()` from the `kind`; an API outage throws out of
 * `StoreData` (route `error.tsx`), and a refusal the page cannot explain throws here: nothing is faked.
 */

/** The API answered a request with a problem the storefront has no page state for (a bug or a contract change). */
export class UnexpectedStoreResponseError extends Error {
  constructor(operation: string, status: number, code: string) {
    super(`${operation} answered ${status} ${code}, which this page does not handle.`);
    this.name = "UnexpectedStoreResponseError";
  }
}

function unwrap<T>(operation: string, outcome: CatalogOutcome<T>): T {
  if (outcome.ok) return outcome.data;
  const error = new UnexpectedStoreResponseError(operation, outcome.status, outcome.problem.code);
  console.error(error.message);
  throw error;
}

/** `currencyExponent` of the shop for the client-rendered cart (`GET /store/config`, read through the same data cache). */
export async function loadShopExponent(data: StoreData): Promise<number> {
  return unwrap("GET /store/config", await data.getConfig()).currencyExponent;
}

/** The shop currency with its digits: an order in another (older) currency is formatted with Intl's digits instead. */
export async function loadShopMoney(data: StoreData): Promise<ShopMoney> {
  const config = unwrap("GET /store/config", await data.getConfig());
  return { currency: config.currency, exponent: config.currencyExponent };
}

/**
 * Whether the shop sends email (`emailDelivery` of `GET /store/config`, false without a provider). Decides whether the
 * storefront shows "Forgot password?" and the verification prompts. Read through the same data cache as the rest of the
 * config, so a change shows within the cache's minute; the routes still answer `404` meanwhile, and the pages handle that.
 */
export async function loadEmailDelivery(data: StoreData): Promise<boolean> {
  return unwrap("GET /store/config", await data.getConfig()).emailDelivery;
}

/**
 * Whether the shop takes payments online (`onlinePayment` of `GET /store/config`, false without a payment provider). Decides
 * the wording of the checkout and whether the order pages may show a pay button. The same cached read as the rest of the
 * config; the order's own `payment.canPay` decides per order, and the payment routes answer `409 payment_not_available`
 * meanwhile if the setting changed.
 */
export async function loadOnlinePayment(data: StoreData): Promise<boolean> {
  return unwrap("GET /store/config", await data.getConfig()).onlinePayment;
}

export interface HomeData {
  newProducts?: ProductSummary[];
  categories?: CategoryNode[];
  /** `currencyExponent` of the shop, present whenever prices are shown. */
  exponent?: number;
}

/** One request per data need: the products of `newProducts` and the category tree for `categoryTiles`. */
export async function loadHomeData(
  data: StoreData,
  locale: string,
  sections: readonly HomeSection[],
): Promise<HomeData> {
  const products = sections.find((section) => section.type === "newProducts");
  const tiles = sections.find((section) => section.type === "categoryTiles");
  const [newProducts, categories, exponent] = await Promise.all([
    products === undefined
      ? undefined
      : data
          .listProducts(locale, { limit: products.props.limit })
          .then((outcome) => unwrap("GET /store/products", outcome).items),
    tiles === undefined
      ? undefined
      : data
          .listCategories(locale)
          .then((outcome) => unwrap("GET /store/categories", outcome).items),
    products === undefined
      ? undefined
      : data.getConfig().then((outcome) => unwrap("GET /store/config", outcome).currencyExponent),
  ]);
  return {
    ...(newProducts === undefined ? {} : { newProducts }),
    ...(categories === undefined ? {} : { categories }),
    ...(exponent === undefined ? {} : { exponent }),
  };
}

export type ListingResult =
  | {
      kind: "ok";
      products: ProductList;
      page: number;
      /** 0 for an empty list; never more than the API's offset cap allows. */
      pageCount: number;
      /** The category of a category page, `null` on the plain catalog. */
      category: CategoryNode | null;
      /** Root-to-category trail; empty on the plain catalog. */
      trail: CategoryNode[];
      /** Name of the filtered brand when a listed product carries it. */
      brandName: string | null;
      /** `currencyExponent` of the shop, for formatting the listed prices. */
      exponent: number;
    }
  | { kind: "not_found" };

export async function loadCatalogListing(
  data: StoreData,
  locale: string,
  options: { categorySlug?: string; query: CatalogQuery },
): Promise<ListingResult> {
  const { query } = options;
  // The API refuses an offset above 10 000 with a 400: a page that deep is simply not found, without asking.
  if (query.page > maxPage(CATALOG_PAGE_SIZE)) return { kind: "not_found" };

  let trail: CategoryNode[] = [];
  if (options.categorySlug !== undefined) {
    const tree = unwrap("GET /store/categories", await data.listCategories(locale)).items;
    const found = categoryTrail(tree, options.categorySlug);
    if (found === null) return { kind: "not_found" };
    trail = found;
  }

  const [productsOutcome, configOutcome] = await Promise.all([
    data.listProducts(locale, {
      limit: CATALOG_PAGE_SIZE,
      offset: offsetForPage(query.page, CATALOG_PAGE_SIZE),
      ...(options.categorySlug === undefined ? {} : { category: options.categorySlug }),
      ...(query.brand === null ? {} : { brand: query.brand }),
    }),
    data.getConfig(),
  ]);
  const products = unwrap("GET /store/products", productsOutcome);
  const { currencyExponent } = unwrap("GET /store/config", configOutcome);
  if (!isPageInRange(query.page, products.total, CATALOG_PAGE_SIZE)) return { kind: "not_found" };

  const brandName =
    query.brand === null
      ? null
      : (products.items.find((item) => item.brand?.slug === query.brand)?.brand?.name ?? null);
  return {
    kind: "ok",
    products,
    page: query.page,
    pageCount: pageCountFor(products.total, CATALOG_PAGE_SIZE),
    category: trail[trail.length - 1] ?? null,
    trail,
    brandName,
    exponent: currencyExponent,
  };
}

export type ProductPageResult =
  | {
      kind: "ok";
      product: ProductDetail;
      /** `currencyExponent` of the shop (`GET /store/config`), for formatting minor units. */
      exponent: number;
      trail: CategoryNode[];
    }
  | { kind: "not_found" };

export async function loadProductPage(
  data: StoreData,
  locale: string,
  slug: string,
): Promise<ProductPageResult> {
  const [productOutcome, configOutcome, categoriesOutcome] = await Promise.all([
    data.getProduct(locale, slug),
    data.getConfig(),
    data.listCategories(locale),
  ]);
  if (!productOutcome.ok) {
    // 404: draft, archived, unknown or no sellable variant; 400: a slug the API refuses (too long). Both are "no such page".
    if (productOutcome.status === 404 || productOutcome.status === 400) {
      return { kind: "not_found" };
    }
    unwrap("GET /store/products/{slug}", productOutcome);
  }
  const product = unwrap("GET /store/products/{slug}", productOutcome);
  const config = unwrap("GET /store/config", configOutcome);
  const tree = unwrap("GET /store/categories", categoriesOutcome).items;
  return {
    kind: "ok",
    product,
    exponent: config.currencyExponent,
    trail: deepestTrail(
      tree,
      product.categories.map((entry) => entry.slug),
    ),
  };
}
