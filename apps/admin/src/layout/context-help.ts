import { PATHS, buildPath, type RouteId } from "../router/paths";

/** The address of a help article, with a section anchor when given (`/help/<article>#<section>`). */
export function helpArticlePath(articleId: string, sectionId?: string): string {
  const path = buildPath(PATHS.helpArticle, { articleId });
  return sectionId === undefined ? path : `${path}#${encodeURIComponent(sectionId)}`;
}

/**
 * Contextual help (knowledge base plan, decision 4): the help article (and section) of each screen, for the "Help for this
 * page" link the shell shows above the page. Ids only, so the entry chunk stays small; the articles themselves are in the
 * help area (`areas/help/content/`). `help-content.spec.ts` checks that every target exists. A client fork that renames or
 * removes an article updates this map in the same change.
 */
export interface ContextHelpTarget {
  article: string;
  section?: string;
}

const CATALOG_TYPES: ContextHelpTarget = { article: "product-types", section: "product-types" };
const ATTRIBUTES: ContextHelpTarget = { article: "product-types", section: "attributes" };
const OPTIONS: ContextHelpTarget = { article: "product-types", section: "options" };
const CATEGORIES: ContextHelpTarget = { article: "categories-brands", section: "categories" };
const BRANDS: ContextHelpTarget = { article: "categories-brands", section: "brands" };
const SHIPPING_METHODS: ContextHelpTarget = { article: "shipping", section: "methods" };
const CARRIERS: ContextHelpTarget = { article: "shipping", section: "carriers" };
const PRIVACY: ContextHelpTarget = { article: "personal-data", section: "requests" };
const USERS: ContextHelpTarget = { article: "users-roles", section: "roles" };
const BANNERS: ContextHelpTarget = { article: "home-banners" };

export const CONTEXT_HELP: Readonly<Partial<Record<RouteId, ContextHelpTarget>>> = {
  home: { article: "first-steps" },
  account: { article: "users-roles", section: "own-account" },
  products: { article: "create-product" },
  productNew: { article: "create-product", section: "create" },
  productDetail: { article: "create-product" },
  attributes: ATTRIBUTES,
  attributeNew: ATTRIBUTES,
  attributeDetail: ATTRIBUTES,
  options: OPTIONS,
  optionNew: OPTIONS,
  optionDetail: OPTIONS,
  productTypes: CATALOG_TYPES,
  productTypeNew: CATALOG_TYPES,
  productTypeDetail: CATALOG_TYPES,
  brands: BRANDS,
  brandNew: BRANDS,
  brandDetail: BRANDS,
  categories: CATEGORIES,
  categoryNew: CATEGORIES,
  categoryDetail: CATEGORIES,
  search: { article: "search" },
  searchSynonyms: { article: "search", section: "synonyms" },
  banners: BANNERS,
  bannerNew: { article: "home-banners", section: "create" },
  bannerDetail: { article: "home-banners", section: "create" },
  orders: { article: "orders" },
  orderDetail: { article: "orders", section: "statuses" },
  customers: { article: "customers" },
  customerDetail: { article: "customers", section: "actions" },
  payments: { article: "payments", section: "attention" },
  shipping: SHIPPING_METHODS,
  shippingMethodNew: SHIPPING_METHODS,
  shippingMethodDetail: SHIPPING_METHODS,
  shippingProviders: CARRIERS,
  shippingProviderDetail: CARRIERS,
  email: { article: "email", section: "status" },
  emailMessages: { article: "email", section: "messages" },
  emailMessageDetail: { article: "email", section: "messages" },
  emailTemplates: { article: "email", section: "templates" },
  emailTemplatePreview: { article: "email", section: "templates" },
  privacy: PRIVACY,
  privacyLookup: PRIVACY,
  privacyRequestDetail: { article: "personal-data", section: "erasure" },
  auditLog: { article: "audit-log" },
  users: USERS,
  userNew: { article: "users-roles", section: "add" },
  userDetail: { article: "users-roles", section: "change" },
};

/**
 * The product editor's tabs (`?tab=` of `/products/:id`), each with the article of that tab. Keys are the editor's tab
 * ids (`areas/products/publish-problems.ts`, checked by the spec); an unknown or missing tab falls back to the route's entry.
 */
export const PRODUCT_TAB_HELP: Readonly<Record<string, ContextHelpTarget>> = {
  general: { article: "create-product", section: "general" },
  attributes: { article: "create-product", section: "attributes" },
  categories: { article: "create-product", section: "categories" },
  media: { article: "images" },
  options: { article: "create-product", section: "options-variants" },
  variants: { article: "create-product", section: "variants" },
  prices: { article: "prices" },
  stock: { article: "stock" },
};

/** The help of the screen at this route (and product tab), or `null` when none (the help pages, sign-in, not found). */
export function contextHelpFor(routeId: string, tab: string | null): ContextHelpTarget | null {
  // Own keys only: `?tab=constructor` must not reach `Object.prototype`.
  if (routeId === "productDetail" && tab !== null && Object.hasOwn(PRODUCT_TAB_HELP, tab)) {
    return PRODUCT_TAB_HELP[tab] ?? null;
  }
  if (!Object.hasOwn(CONTEXT_HELP, routeId)) return null;
  return (CONTEXT_HELP as Readonly<Record<string, ContextHelpTarget>>)[routeId] ?? null;
}
