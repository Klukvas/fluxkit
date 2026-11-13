import type { AdminOperationName, AdminOperationPermission } from "@fluxkit/api-client";
import type { ComponentType } from "react";
import { HomePage } from "./areas/home/home-page";
import { LoginPage } from "./areas/auth/login-page";
import type { FeatureRouteId } from "./features/manifest";
import { ADMIN_FEATURES } from "./features/registry";
import type { LazyFile } from "./messages";
import { permissionOf } from "./permissions";
import { PATHS, type RouteId } from "./router/paths";

/**
 * The route table (plan, "Routing, data and state"). One row per screen: its path (relative to the base path
 * `/admin-ui`), the API operation the screen needs and so its permission (from `ADMIN_OPERATIONS`; only `/login` is
 * public), the message key of its title, and its page. The sign-in page and the start page are in the entry chunk;
 * every other area is its own lazy chunk (`build-output.spec.ts` checks the split and the entry budget). A later step
 * replaces an area's placeholder by filling its module; the row stays.
 */

export type RoutePage =
  { kind: "eager"; Component: ComponentType } | { kind: "lazy"; load: () => Promise<LazyPage> };

/** A loaded lazy page: the component and the lazy message files its area needs before it renders. */
export interface LazyPage {
  Component: ComponentType;
  messageFiles: readonly LazyFile[];
}

/**
 * What every lazily loaded area module exports besides its pages: the lazy message files its screens use (`[]` when the
 * eager messages are enough). The type makes it impossible to forget; `messages.spec.ts` checks the list against the keys
 * the area's source uses.
 */
export interface AreaModule {
  MESSAGE_FILES: readonly LazyFile[];
}

export interface AppRoute {
  id: RouteId;
  path: string;
  /** The operation whose permission guards the screen (its main read, or the session operation). */
  operation: AdminOperationName;
  permission: AdminOperationPermission;
  titleKey: string;
  page: RoutePage;
}

function route(
  id: RouteId,
  operation: AdminOperationName,
  titleKey: string,
  page: RoutePage,
): AppRoute {
  return { id, path: PATHS[id], operation, permission: permissionOf(operation), titleKey, page };
}

function areaPage<Module extends AreaModule>(
  load: () => Promise<Module>,
  pick: (module: Module) => ComponentType,
): RoutePage {
  return {
    kind: "lazy",
    load: () =>
      load().then((module) => ({ Component: pick(module), messageFiles: module.MESSAGE_FILES })),
  };
}

export const ROUTES: readonly AppRoute[] = [
  route("login", "login", "page.login.title", { kind: "eager", Component: LoginPage }),
  route("home", "getMe", "page.home.title", { kind: "eager", Component: HomePage }),
  route(
    "account",
    "changePassword",
    "page.account.title",
    areaPage(
      () => import("./areas/account/account-page"),
      (module) => module.AccountPage,
    ),
  ),
  route(
    "products",
    "listProducts",
    "page.products.title",
    areaPage(
      () => import("./areas/products"),
      (module) => module.ProductsPage,
    ),
  ),
  route(
    "productNew",
    "createProduct",
    "page.productNew.title",
    areaPage(
      () => import("./areas/products"),
      (module) => module.ProductNewPage,
    ),
  ),
  route(
    "productDetail",
    "getProduct",
    "page.productDetail.title",
    areaPage(
      () => import("./areas/products"),
      (module) => module.ProductDetailPage,
    ),
  ),
  route(
    "attributes",
    "listAttributes",
    "page.attributes.title",
    areaPage(
      () => import("./areas/catalog-dictionaries"),
      (module) => module.AttributesPage,
    ),
  ),
  route(
    "attributeNew",
    "createAttribute",
    "page.attributeNew.title",
    areaPage(
      () => import("./areas/catalog-dictionaries"),
      (module) => module.AttributeNewPage,
    ),
  ),
  route(
    "attributeDetail",
    "getAttribute",
    "page.attributeDetail.title",
    areaPage(
      () => import("./areas/catalog-dictionaries"),
      (module) => module.AttributeDetailPage,
    ),
  ),
  route(
    "options",
    "listOptions",
    "page.options.title",
    areaPage(
      () => import("./areas/catalog-dictionaries"),
      (module) => module.OptionsPage,
    ),
  ),
  route(
    "optionNew",
    "createOption",
    "page.optionNew.title",
    areaPage(
      () => import("./areas/catalog-dictionaries"),
      (module) => module.OptionNewPage,
    ),
  ),
  route(
    "optionDetail",
    "getOption",
    "page.optionDetail.title",
    areaPage(
      () => import("./areas/catalog-dictionaries"),
      (module) => module.OptionDetailPage,
    ),
  ),
  route(
    "productTypes",
    "listProductTypes",
    "page.productTypes.title",
    areaPage(
      () => import("./areas/catalog-dictionaries"),
      (module) => module.ProductTypesPage,
    ),
  ),
  route(
    "productTypeNew",
    "createProductType",
    "page.productTypeNew.title",
    areaPage(
      () => import("./areas/catalog-dictionaries"),
      (module) => module.ProductTypeNewPage,
    ),
  ),
  route(
    "productTypeDetail",
    "getProductType",
    "page.productTypeDetail.title",
    areaPage(
      () => import("./areas/catalog-dictionaries"),
      (module) => module.ProductTypeDetailPage,
    ),
  ),
  route(
    "brands",
    "listBrands",
    "page.brands.title",
    areaPage(
      () => import("./areas/catalog-dictionaries"),
      (module) => module.BrandsPage,
    ),
  ),
  route(
    "brandNew",
    "createBrand",
    "page.brandNew.title",
    areaPage(
      () => import("./areas/catalog-dictionaries"),
      (module) => module.BrandNewPage,
    ),
  ),
  route(
    "brandDetail",
    "getBrand",
    "page.brandDetail.title",
    areaPage(
      () => import("./areas/catalog-dictionaries"),
      (module) => module.BrandDetailPage,
    ),
  ),
  route(
    "categories",
    "listCategories",
    "page.categories.title",
    areaPage(
      () => import("./areas/catalog-dictionaries"),
      (module) => module.CategoriesPage,
    ),
  ),
  route(
    "categoryNew",
    "createCategory",
    "page.categoryNew.title",
    areaPage(
      () => import("./areas/catalog-dictionaries"),
      (module) => module.CategoryNewPage,
    ),
  ),
  route(
    "categoryDetail",
    "getCategory",
    "page.categoryDetail.title",
    areaPage(
      () => import("./areas/catalog-dictionaries"),
      (module) => module.CategoryDetailPage,
    ),
  ),
  route(
    "search",
    "getSearchStatus",
    "page.search.title",
    areaPage(
      () => import("./areas/search"),
      (module) => module.SearchStatusPage,
    ),
  ),
  route(
    "searchSynonyms",
    "listSynonymGroups",
    "page.searchSynonyms.title",
    areaPage(
      () => import("./areas/search"),
      (module) => module.SearchSynonymsPage,
    ),
  ),
  route(
    "banners",
    "listHomeBanners",
    "page.banners.title",
    areaPage(
      () => import("./areas/banners"),
      (module) => module.BannersPage,
    ),
  ),
  route(
    "bannerNew",
    "createHomeBanner",
    "page.bannerNew.title",
    areaPage(
      () => import("./areas/banners"),
      (module) => module.BannerNewPage,
    ),
  ),
  route(
    "bannerDetail",
    "getHomeBanner",
    "page.bannerDetail.title",
    areaPage(
      () => import("./areas/banners"),
      (module) => module.BannerDetailPage,
    ),
  ),
  route(
    "orders",
    "listOrders",
    "page.orders.title",
    areaPage(
      () => import("./areas/orders"),
      (module) => module.OrdersPage,
    ),
  ),
  route(
    "orderDetail",
    "getOrder",
    "page.orderDetail.title",
    areaPage(
      () => import("./areas/orders"),
      (module) => module.OrderDetailPage,
    ),
  ),
  route(
    "customers",
    "listCustomers",
    "page.customers.title",
    areaPage(
      () => import("./areas/customers"),
      (module) => module.CustomersPage,
    ),
  ),
  route(
    "customerDetail",
    "getCustomer",
    "page.customerDetail.title",
    areaPage(
      () => import("./areas/customers"),
      (module) => module.CustomerDetailPage,
    ),
  ),
  route(
    "payments",
    "listPayments",
    "page.payments.title",
    areaPage(
      () => import("./areas/payments"),
      (module) => module.PaymentsPage,
    ),
  ),
  route(
    "shipping",
    "listShippingMethods",
    "page.shipping.title",
    areaPage(
      () => import("./areas/shipping"),
      (module) => module.ShippingPage,
    ),
  ),
  route(
    "shippingMethodNew",
    "createShippingMethod",
    "page.shippingMethodNew.title",
    areaPage(
      () => import("./areas/shipping"),
      (module) => module.ShippingMethodNewPage,
    ),
  ),
  route(
    "shippingMethodDetail",
    "getShippingMethod",
    "page.shippingMethodDetail.title",
    areaPage(
      () => import("./areas/shipping"),
      (module) => module.ShippingMethodDetailPage,
    ),
  ),
  route(
    "shippingProviders",
    "getShippingProviderSettings",
    "page.shippingProviders.title",
    areaPage(
      () => import("./areas/shipping"),
      (module) => module.ShippingProvidersPage,
    ),
  ),
  route(
    "shippingProviderDetail",
    "getShippingProviderSettings",
    "page.shippingProviderDetail.title",
    areaPage(
      () => import("./areas/shipping"),
      (module) => module.ShippingProviderDetailPage,
    ),
  ),
  route(
    "email",
    "getEmailStatus",
    "page.email.title",
    areaPage(
      () => import("./areas/email"),
      (module) => module.EmailStatusPage,
    ),
  ),
  route(
    "emailMessages",
    "listEmailMessages",
    "page.emailMessages.title",
    areaPage(
      () => import("./areas/email"),
      (module) => module.EmailMessagesPage,
    ),
  ),
  route(
    "emailMessageDetail",
    "getEmailMessage",
    "page.emailMessageDetail.title",
    areaPage(
      () => import("./areas/email"),
      (module) => module.EmailMessageDetailPage,
    ),
  ),
  route(
    "emailTemplates",
    "listEmailTemplates",
    "page.emailTemplates.title",
    areaPage(
      () => import("./areas/email"),
      (module) => module.EmailTemplatesPage,
    ),
  ),
  route(
    "emailTemplatePreview",
    "previewEmailTemplate",
    "page.emailTemplatePreview.title",
    areaPage(
      () => import("./areas/email"),
      (module) => module.EmailTemplatePreviewPage,
    ),
  ),
  route(
    "privacy",
    "listPrivacyRequests",
    "page.privacy.title",
    areaPage(
      () => import("./areas/privacy"),
      (module) => module.PrivacyRequestsPage,
    ),
  ),
  route(
    "privacyLookup",
    "privacyLookup",
    "page.privacyLookup.title",
    areaPage(
      () => import("./areas/privacy"),
      (module) => module.PrivacyLookupPage,
    ),
  ),
  route(
    "privacyRequestDetail",
    "getPrivacyRequest",
    "page.privacyRequestDetail.title",
    areaPage(
      () => import("./areas/privacy"),
      (module) => module.PrivacyRequestDetailPage,
    ),
  ),
  route(
    "auditLog",
    "listAuditEvents",
    "page.auditLog.title",
    areaPage(
      () => import("./areas/audit"),
      (module) => module.AuditLogPage,
    ),
  ),
  route(
    "users",
    "listUsers",
    "page.users.title",
    areaPage(
      () => import("./areas/users"),
      (module) => module.UsersPage,
    ),
  ),
  route(
    "userNew",
    "createUser",
    "page.userNew.title",
    areaPage(
      () => import("./areas/users"),
      (module) => module.UserNewPage,
    ),
  ),
  route(
    "userDetail",
    "getUser",
    "page.userDetail.title",
    areaPage(
      () => import("./areas/users"),
      (module) => module.UserDetailPage,
    ),
  ),
  // The knowledge base: every signed-in role may read it, so it is guarded by the session operation like the start page.
  route(
    "help",
    "getMe",
    "page.help.title",
    areaPage(
      () => import("./areas/help"),
      (module) => module.HelpIndexPage,
    ),
  ),
  route(
    "helpArticle",
    "getMe",
    "page.helpArticle.title",
    areaPage(
      () => import("./areas/help"),
      (module) => module.HelpArticlePage,
    ),
  ),
];

/**
 * A screen of an optional feature (ADR 0049, E8; `features/manifest.ts`): from its manifest, never from `PATHS` or
 * `ADMIN_OPERATIONS` (the feature's routes are not in the core API document). It renders only when the API lists its
 * feature in `GET /admin/config` `features` and the role has its permission (`layout/feature-gate.ts`).
 */
export interface FeatureAppRoute {
  id: FeatureRouteId;
  feature: string;
  path: string;
  permission: AdminOperationPermission;
  titleKey: string;
  page: RoutePage;
}

/** The screens of every feature slice of this build (none without a slice). */
export const FEATURE_ROUTES: readonly FeatureAppRoute[] = ADMIN_FEATURES.flatMap((feature) =>
  feature.routes.map((route) => ({
    id: route.id,
    feature: feature.name,
    path: route.path,
    permission: route.permission,
    titleKey: route.titleKey,
    page: { kind: "lazy", load: route.load } satisfies RoutePage,
  })),
);

export function featureRouteById(id: FeatureRouteId): FeatureAppRoute {
  const found = FEATURE_ROUTES.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`No feature route "${id}".`);
  return found;
}

export function routeById(id: RouteId): AppRoute {
  const found = ROUTES.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`No route "${id}" in the route table.`);
  return found;
}
