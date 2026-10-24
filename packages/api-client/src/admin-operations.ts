import type { AdminPermission } from "./admin-types.js";
import type { HttpMethod } from "./request.js";

/**
 * What `x-fluxkit-permission` in `docs/api/openapi.json` may say: a permission name the signed-in admin must hold,
 * `authenticated` (any signed-in admin), `public` (no session) or `denied` (nobody; the route is refused).
 */
export type AdminOperationPermission = AdminPermission | "authenticated" | "public" | "denied";

export type AdminBodyKind = "none" | "json" | "binary";

/** One row per operation of the admin API: `docs/api/openapi.json`, every path under `/admin`. */
export interface AdminOperationSpec {
  method: HttpMethod;
  /** OpenAPI path template. */
  path: string;
  /** Success statuses the document lists. Every other 2xx is an unexpected answer. */
  successStatuses: readonly number[];
  /** The permission the API enforces, copied from `x-fluxkit-permission`. The SPA hides what the user may not do; the API decides. */
  permission: AdminOperationPermission;
  /** Whether the operation takes a request body of any kind (`bodyKind !== "none"`). */
  hasBody: boolean;
  /**
   * `json`: `application/json`. `binary`: raw bytes with `application/octet-stream`, the media upload only (ADR 0028);
   * the API refuses that type on every other admin route.
   */
  bodyKind: AdminBodyKind;
  /** Query parameter names the document lists. */
  query: readonly string[];
}

interface OperationRow<
  Method extends HttpMethod,
  Path extends string,
  Statuses extends readonly number[],
  Permission extends AdminOperationPermission,
  Kind extends AdminBodyKind,
  Query extends readonly string[],
> extends AdminOperationSpec {
  method: Method;
  path: Path;
  successStatuses: Statuses;
  permission: Permission;
  hasBody: Kind extends "none" ? false : true;
  bodyKind: Kind;
  query: Query;
}

/**
 * Overloads (not a defaulted type parameter): TypeScript widens an inferred-from-nothing parameter to its constraint,
 * which would turn every `bodyKind: "none"` into the whole union and break the types the contract test derives.
 */
function operation<
  const Method extends HttpMethod,
  const Path extends string,
  const Statuses extends readonly number[],
  const Permission extends AdminOperationPermission,
  const Kind extends Exclude<AdminBodyKind, "none">,
  const Query extends readonly string[] = readonly [],
>(
  method: Method,
  path: Path,
  successStatuses: Statuses,
  permission: Permission,
  options: { body: Kind; query?: Query },
): OperationRow<Method, Path, Statuses, Permission, Kind, Query>;
function operation<
  const Method extends HttpMethod,
  const Path extends string,
  const Statuses extends readonly number[],
  const Permission extends AdminOperationPermission,
  const Query extends readonly string[] = readonly [],
>(
  method: Method,
  path: Path,
  successStatuses: Statuses,
  permission: Permission,
  options?: { query?: Query },
): OperationRow<Method, Path, Statuses, Permission, "none", Query>;
function operation(
  method: HttpMethod,
  path: string,
  successStatuses: readonly number[],
  permission: AdminOperationPermission,
  options: { body?: AdminBodyKind; query?: readonly string[] } = {},
): AdminOperationSpec {
  const bodyKind = options.body ?? "none";
  return {
    method,
    path,
    successStatuses,
    permission,
    hasBody: bodyKind !== "none",
    bodyKind,
    query: options.query ?? [],
  };
}

/**
 * The names are the client function names. `admin-contract.spec.ts` walks `docs/api/openapi.json` and fails when an
 * `/admin` operation is missing here, when a row has no operation in the document, or when method, path, statuses,
 * query parameters, body, CSRF header or permission differ. No store route belongs here (see `OPERATIONS`).
 */
export const ADMIN_OPERATIONS = {
  login: operation("POST", "/admin/auth/login", [200], "public", { body: "json" }),
  logout: operation("POST", "/admin/auth/logout", [204], "authenticated"),
  getMe: operation("GET", "/admin/auth/me", [200], "authenticated"),
  changePassword: operation("POST", "/admin/auth/change-password", [204], "authenticated", {
    body: "json",
  }),
  listUsers: operation("GET", "/admin/users", [200], "users.manage", {
    query: ["limit", "offset"],
  }),
  createUser: operation("POST", "/admin/users", [201], "users.manage", { body: "json" }),
  getUser: operation("GET", "/admin/users/{id}", [200], "users.manage"),
  updateUser: operation("PATCH", "/admin/users/{id}", [200], "users.manage", { body: "json" }),
  resetUserPassword: operation("POST", "/admin/users/{id}/reset-password", [204], "users.manage", {
    body: "json",
  }),
  getConfig: operation("GET", "/admin/config", [200], "authenticated"),
  /** The only binary body: the file bytes, `application/octet-stream`, `Content-Length` set by `fetch`. */
  uploadMedia: operation("POST", "/admin/media/uploads", [201], "catalog.write", {
    body: "binary",
  }),
  listCustomers: operation("GET", "/admin/customers", [200], "customers.read", {
    query: ["q", "limit", "offset"],
  }),
  getCustomer: operation("GET", "/admin/customers/{id}", [200], "customers.read"),
  updateCustomer: operation("PATCH", "/admin/customers/{id}", [200], "customers.write", {
    body: "json",
  }),
  unlockCustomer: operation("POST", "/admin/customers/{id}/unlock", [204], "customers.write"),
  getProductInventory: operation("GET", "/admin/products/{id}/inventory", [200], "catalog.read"),
  getVariantInventory: operation(
    "GET",
    "/admin/products/{id}/variants/{variantId}/inventory",
    [200],
    "catalog.read",
  ),
  adjustInventory: operation(
    "POST",
    "/admin/products/{id}/variants/{variantId}/inventory/adjustments",
    [201],
    "catalog.write",
    { body: "json" },
  ),
  listStockMovements: operation(
    "GET",
    "/admin/products/{id}/variants/{variantId}/inventory/movements",
    [200],
    "catalog.read",
    { query: ["limit", "offset"] },
  ),
  listReservations: operation(
    "GET",
    "/admin/products/{id}/variants/{variantId}/inventory/reservations",
    [200],
    "orders.read",
    { query: ["status", "limit", "offset"] },
  ),
  listLocations: operation("GET", "/admin/locations", [200], "catalog.read"),
  listOrders: operation("GET", "/admin/orders", [200], "orders.read", {
    query: ["customerId", "q", "placedTo", "placedFrom", "status", "offset", "limit"],
  }),
  getOrder: operation("GET", "/admin/orders/{id}", [200], "orders.read"),
  cancelOrder: operation("POST", "/admin/orders/{id}/cancel", [200], "orders.write", {
    body: "json",
  }),
  markOrderPaid: operation("POST", "/admin/orders/{id}/mark-paid", [200], "orders.write", {
    body: "json",
  }),
  markOrderFulfilled: operation("POST", "/admin/orders/{id}/mark-fulfilled", [200], "orders.write"),
  createAttribute: operation("POST", "/admin/attributes", [201], "catalog.write", {
    body: "json",
  }),
  listAttributes: operation("GET", "/admin/attributes", [200], "catalog.read", {
    query: ["limit", "offset"],
  }),
  getAttribute: operation("GET", "/admin/attributes/{id}", [200], "catalog.read"),
  updateAttribute: operation("PATCH", "/admin/attributes/{id}", [200], "catalog.write", {
    body: "json",
  }),
  deleteAttribute: operation("DELETE", "/admin/attributes/{id}", [204], "catalog.write"),
  createAttributeOption: operation(
    "POST",
    "/admin/attributes/{id}/options",
    [201],
    "catalog.write",
    { body: "json" },
  ),
  updateAttributeOption: operation(
    "PATCH",
    "/admin/attributes/{id}/options/{optionId}",
    [200],
    "catalog.write",
    { body: "json" },
  ),
  deleteAttributeOption: operation(
    "DELETE",
    "/admin/attributes/{id}/options/{optionId}",
    [204],
    "catalog.write",
  ),
  createBrand: operation("POST", "/admin/brands", [201], "catalog.write", { body: "json" }),
  listBrands: operation("GET", "/admin/brands", [200], "catalog.read", {
    query: ["limit", "offset"],
  }),
  getBrand: operation("GET", "/admin/brands/{id}", [200], "catalog.read"),
  updateBrand: operation("PATCH", "/admin/brands/{id}", [200], "catalog.write", { body: "json" }),
  deleteBrand: operation("DELETE", "/admin/brands/{id}", [204], "catalog.write"),
  createShippingMethod: operation("POST", "/admin/shipping/methods", [201], "shipping.manage", {
    body: "json",
  }),
  listShippingMethods: operation("GET", "/admin/shipping/methods", [200], "shipping.manage", {
    query: ["limit", "offset"],
  }),
  getShippingMethod: operation("GET", "/admin/shipping/methods/{id}", [200], "shipping.manage"),
  updateShippingMethod: operation(
    "PATCH",
    "/admin/shipping/methods/{id}",
    [200],
    "shipping.manage",
    {
      body: "json",
    },
  ),
  deleteShippingMethod: operation(
    "DELETE",
    "/admin/shipping/methods/{id}",
    [204],
    "shipping.manage",
  ),
  getShippingProviderSettings: operation(
    "GET",
    "/admin/shipping/providers/{code}/settings",
    [200],
    "shipping.manage",
  ),
  putShippingProviderSettings: operation(
    "PUT",
    "/admin/shipping/providers/{code}/settings",
    [200],
    "shipping.manage",
    { body: "json" },
  ),
  checkShippingProvider: operation(
    "POST",
    "/admin/shipping/providers/{code}/check",
    [200],
    "shipping.manage",
  ),
  createCategory: operation("POST", "/admin/categories", [201], "catalog.write", { body: "json" }),
  listCategories: operation("GET", "/admin/categories", [200], "catalog.read", {
    query: ["parentId", "limit", "offset"],
  }),
  getCategory: operation("GET", "/admin/categories/{id}", [200], "catalog.read"),
  updateCategory: operation("PATCH", "/admin/categories/{id}", [200], "catalog.write", {
    body: "json",
  }),
  deleteCategory: operation("DELETE", "/admin/categories/{id}", [204], "catalog.write"),
  moveCategory: operation("POST", "/admin/categories/{id}/move", [200], "catalog.write", {
    body: "json",
  }),
  createOption: operation("POST", "/admin/options", [201], "catalog.write", { body: "json" }),
  listOptions: operation("GET", "/admin/options", [200], "catalog.read", {
    query: ["limit", "offset"],
  }),
  getOption: operation("GET", "/admin/options/{id}", [200], "catalog.read"),
  updateOption: operation("PATCH", "/admin/options/{id}", [200], "catalog.write", {
    body: "json",
  }),
  deleteOption: operation("DELETE", "/admin/options/{id}", [204], "catalog.write"),
  createOptionValue: operation("POST", "/admin/options/{id}/values", [201], "catalog.write", {
    body: "json",
  }),
  updateOptionValue: operation(
    "PATCH",
    "/admin/options/{id}/values/{valueId}",
    [200],
    "catalog.write",
    { body: "json" },
  ),
  deleteOptionValue: operation(
    "DELETE",
    "/admin/options/{id}/values/{valueId}",
    [204],
    "catalog.write",
  ),
  createProductType: operation("POST", "/admin/product-types", [201], "catalog.write", {
    body: "json",
  }),
  listProductTypes: operation("GET", "/admin/product-types", [200], "catalog.read", {
    query: ["limit", "offset"],
  }),
  getProductType: operation("GET", "/admin/product-types/{id}", [200], "catalog.read"),
  updateProductType: operation("PATCH", "/admin/product-types/{id}", [200], "catalog.write", {
    body: "json",
  }),
  deleteProductType: operation("DELETE", "/admin/product-types/{id}", [204], "catalog.write"),
  putProductTypeAttribute: operation(
    "PUT",
    "/admin/product-types/{id}/attributes/{attributeId}",
    [200, 201],
    "catalog.write",
    { body: "json" },
  ),
  removeProductTypeAttribute: operation(
    "DELETE",
    "/admin/product-types/{id}/attributes/{attributeId}",
    [204],
    "catalog.write",
  ),
  putProductTypeOption: operation(
    "PUT",
    "/admin/product-types/{id}/options/{optionId}",
    [200, 201],
    "catalog.write",
    { body: "json" },
  ),
  removeProductTypeOption: operation(
    "DELETE",
    "/admin/product-types/{id}/options/{optionId}",
    [204],
    "catalog.write",
  ),
  listVariantPrices: operation(
    "GET",
    "/admin/products/{id}/variants/{variantId}/prices",
    [200],
    "catalog.read",
  ),
  listProductPrices: operation("GET", "/admin/products/{id}/prices", [200], "catalog.read"),
  putProductPrices: operation("PUT", "/admin/products/{id}/prices", [200], "catalog.write", {
    body: "json",
  }),
  putVariantPrice: operation(
    "PUT",
    "/admin/products/{id}/variants/{variantId}/prices/{currency}",
    [200, 201],
    "catalog.write",
    { body: "json" },
  ),
  deleteVariantPrice: operation(
    "DELETE",
    "/admin/products/{id}/variants/{variantId}/prices/{currency}",
    [204],
    "catalog.write",
  ),
  createProduct: operation("POST", "/admin/products", [201], "catalog.write", { body: "json" }),
  listProducts: operation("GET", "/admin/products", [200], "catalog.read", {
    query: ["q", "brandId", "categoryId", "status", "limit", "offset"],
  }),
  getProduct: operation("GET", "/admin/products/{id}", [200], "catalog.read"),
  updateProduct: operation("PATCH", "/admin/products/{id}", [200], "catalog.write", {
    body: "json",
  }),
  deleteProduct: operation("DELETE", "/admin/products/{id}", [204], "catalog.write"),
  publishProduct: operation("POST", "/admin/products/{id}/publish", [200], "catalog.publish"),
  unpublishProduct: operation("POST", "/admin/products/{id}/unpublish", [200], "catalog.publish"),
  archiveProduct: operation("POST", "/admin/products/{id}/archive", [200], "catalog.publish"),
  restoreProduct: operation("POST", "/admin/products/{id}/restore", [200], "catalog.publish"),
  putProductCategories: operation(
    "PUT",
    "/admin/products/{id}/categories",
    [200],
    "catalog.write",
    { body: "json" },
  ),
  putProductMedia: operation("PUT", "/admin/products/{id}/media", [200], "catalog.write", {
    body: "json",
  }),
  putProductOptions: operation("PUT", "/admin/products/{id}/options", [200], "catalog.write", {
    body: "json",
  }),
  addProductOptionValue: operation(
    "POST",
    "/admin/products/{id}/options/{optionId}/values",
    [201],
    "catalog.write",
    { body: "json" },
  ),
  listVariants: operation("GET", "/admin/products/{id}/variants", [200], "catalog.read", {
    query: ["limit", "offset"],
  }),
  createVariant: operation("POST", "/admin/products/{id}/variants", [201], "catalog.write", {
    body: "json",
  }),
  generateVariants: operation(
    "POST",
    "/admin/products/{id}/variants/generate",
    [200],
    "catalog.write",
  ),
  getVariant: operation("GET", "/admin/products/{id}/variants/{variantId}", [200], "catalog.read"),
  updateVariant: operation(
    "PATCH",
    "/admin/products/{id}/variants/{variantId}",
    [200],
    "catalog.write",
    { body: "json" },
  ),
  deleteVariant: operation(
    "DELETE",
    "/admin/products/{id}/variants/{variantId}",
    [204],
    "catalog.write",
  ),
} as const satisfies Record<string, AdminOperationSpec>;

export type AdminOperationName = keyof typeof ADMIN_OPERATIONS;
