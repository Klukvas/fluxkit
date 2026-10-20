import type { AdminOperationName, AdminOperationPermission } from "@fluxkit/api-client";
import type { ComponentType } from "react";
import { HomePage } from "./areas/home/home-page";
import { LoginPage } from "./areas/auth/login-page";
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
  | { kind: "eager"; Component: ComponentType }
  | { kind: "lazy"; load: () => Promise<ComponentType> };

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

const lazy = (load: () => Promise<ComponentType>): RoutePage => ({ kind: "lazy", load });

export const ROUTES: readonly AppRoute[] = [
  route("login", "login", "page.login.title", { kind: "eager", Component: LoginPage }),
  route("home", "getMe", "page.home.title", { kind: "eager", Component: HomePage }),
  route(
    "account",
    "changePassword",
    "page.account.title",
    lazy(() => import("./areas/account/account-page").then((module) => module.AccountPage)),
  ),
  route(
    "products",
    "listProducts",
    "page.products.title",
    lazy(() => import("./areas/products").then((module) => module.ProductsPage)),
  ),
  route(
    "attributes",
    "listAttributes",
    "page.attributes.title",
    lazy(() => import("./areas/catalog-dictionaries").then((module) => module.AttributesPage)),
  ),
  route(
    "attributeNew",
    "createAttribute",
    "page.attributeNew.title",
    lazy(() => import("./areas/catalog-dictionaries").then((module) => module.AttributeNewPage)),
  ),
  route(
    "attributeDetail",
    "getAttribute",
    "page.attributeDetail.title",
    lazy(() => import("./areas/catalog-dictionaries").then((module) => module.AttributeDetailPage)),
  ),
  route(
    "options",
    "listOptions",
    "page.options.title",
    lazy(() => import("./areas/catalog-dictionaries").then((module) => module.OptionsPage)),
  ),
  route(
    "optionNew",
    "createOption",
    "page.optionNew.title",
    lazy(() => import("./areas/catalog-dictionaries").then((module) => module.OptionNewPage)),
  ),
  route(
    "optionDetail",
    "getOption",
    "page.optionDetail.title",
    lazy(() => import("./areas/catalog-dictionaries").then((module) => module.OptionDetailPage)),
  ),
  route(
    "productTypes",
    "listProductTypes",
    "page.productTypes.title",
    lazy(() => import("./areas/catalog-dictionaries").then((module) => module.ProductTypesPage)),
  ),
  route(
    "productTypeNew",
    "createProductType",
    "page.productTypeNew.title",
    lazy(() => import("./areas/catalog-dictionaries").then((module) => module.ProductTypeNewPage)),
  ),
  route(
    "productTypeDetail",
    "getProductType",
    "page.productTypeDetail.title",
    lazy(() =>
      import("./areas/catalog-dictionaries").then((module) => module.ProductTypeDetailPage),
    ),
  ),
  route(
    "brands",
    "listBrands",
    "page.brands.title",
    lazy(() => import("./areas/catalog-dictionaries").then((module) => module.BrandsPage)),
  ),
  route(
    "brandNew",
    "createBrand",
    "page.brandNew.title",
    lazy(() => import("./areas/catalog-dictionaries").then((module) => module.BrandNewPage)),
  ),
  route(
    "brandDetail",
    "getBrand",
    "page.brandDetail.title",
    lazy(() => import("./areas/catalog-dictionaries").then((module) => module.BrandDetailPage)),
  ),
  route(
    "categories",
    "listCategories",
    "page.categories.title",
    lazy(() => import("./areas/catalog-dictionaries").then((module) => module.CategoriesPage)),
  ),
  route(
    "categoryNew",
    "createCategory",
    "page.categoryNew.title",
    lazy(() => import("./areas/catalog-dictionaries").then((module) => module.CategoryNewPage)),
  ),
  route(
    "categoryDetail",
    "getCategory",
    "page.categoryDetail.title",
    lazy(() => import("./areas/catalog-dictionaries").then((module) => module.CategoryDetailPage)),
  ),
  route(
    "orders",
    "listOrders",
    "page.orders.title",
    lazy(() => import("./areas/orders").then((module) => module.OrdersPage)),
  ),
  route(
    "customers",
    "listCustomers",
    "page.customers.title",
    lazy(() => import("./areas/customers").then((module) => module.CustomersPage)),
  ),
  route(
    "users",
    "listUsers",
    "page.users.title",
    lazy(() => import("./areas/users").then((module) => module.UsersPage)),
  ),
];

export function routeById(id: RouteId): AppRoute {
  const found = ROUTES.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`No route "${id}" in the route table.`);
  return found;
}
