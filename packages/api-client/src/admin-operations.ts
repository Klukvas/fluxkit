import type { AdminPermission } from "./admin-types.js";
import type { HttpMethod } from "./request.js";

/**
 * What `x-fluxkit-permission` in `docs/api/openapi.json` may say: a permission name the signed-in admin must hold,
 * `authenticated` (any signed-in admin), `public` (no session) or `denied` (nobody; the route is refused).
 */
export type AdminOperationPermission = AdminPermission | "authenticated" | "public" | "denied";

/** One row per operation of the admin API: `docs/api/openapi.json`, every path under `/admin`. */
export interface AdminOperationSpec {
  method: HttpMethod;
  /** OpenAPI path template. */
  path: string;
  /** Success statuses the document lists. Every other 2xx is an unexpected answer. */
  successStatuses: readonly number[];
  /** The permission the API enforces, copied from `x-fluxkit-permission`. The SPA hides what the user may not do; the API decides. */
  permission: AdminOperationPermission;
  /** Whether the operation takes a JSON request body. */
  hasBody: boolean;
  /** Query parameter names the document lists. */
  query: readonly string[];
}

/** Generic so that the table keeps the literal method, path, statuses and body flag: the contract test derives types from them. */
function operation<
  const Method extends HttpMethod,
  const Path extends string,
  const Statuses extends readonly number[],
  const Permission extends AdminOperationPermission,
  const HasBody extends boolean = false,
  const Query extends readonly string[] = readonly [],
>(
  method: Method,
  path: Path,
  successStatuses: Statuses,
  permission: Permission,
  options: { hasBody?: HasBody; query?: Query } = {},
) {
  return {
    method,
    path,
    successStatuses,
    permission,
    hasBody: (options.hasBody ?? false) as HasBody,
    query: (options.query ?? []) as Query,
  } satisfies AdminOperationSpec;
}

/**
 * The names are the client function names. `admin-contract.spec.ts` walks `docs/api/openapi.json` and fails when an
 * `/admin` operation is missing here, when a row has no operation in the document, or when method, path, statuses,
 * query parameters, body, CSRF header or permission differ. No store route belongs here (see `OPERATIONS`).
 */
export const ADMIN_OPERATIONS = {
  login: operation("POST", "/admin/auth/login", [200], "public", { hasBody: true }),
  logout: operation("POST", "/admin/auth/logout", [204], "authenticated"),
  getMe: operation("GET", "/admin/auth/me", [200], "authenticated"),
  changePassword: operation("POST", "/admin/auth/change-password", [204], "authenticated", {
    hasBody: true,
  }),
  listUsers: operation("GET", "/admin/users", [200], "users.manage", {
    query: ["limit", "offset"],
  }),
  createUser: operation("POST", "/admin/users", [201], "users.manage", { hasBody: true }),
  getUser: operation("GET", "/admin/users/{id}", [200], "users.manage"),
  updateUser: operation("PATCH", "/admin/users/{id}", [200], "users.manage", { hasBody: true }),
  resetUserPassword: operation("POST", "/admin/users/{id}/reset-password", [204], "users.manage", {
    hasBody: true,
  }),
  getConfig: operation("GET", "/admin/config", [200], "authenticated"),
  listCustomers: operation("GET", "/admin/customers", [200], "customers.read", {
    query: ["q", "limit", "offset"],
  }),
  getCustomer: operation("GET", "/admin/customers/{id}", [200], "customers.read"),
  updateCustomer: operation("PATCH", "/admin/customers/{id}", [200], "customers.write", {
    hasBody: true,
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
    { hasBody: true },
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
    hasBody: true,
  }),
  markOrderPaid: operation("POST", "/admin/orders/{id}/mark-paid", [200], "orders.write", {
    hasBody: true,
  }),
  markOrderFulfilled: operation("POST", "/admin/orders/{id}/mark-fulfilled", [200], "orders.write"),
  createAttribute: operation("POST", "/admin/attributes", [201], "catalog.write", {
    hasBody: true,
  }),
  listAttributes: operation("GET", "/admin/attributes", [200], "catalog.read", {
    query: ["limit", "offset"],
  }),
  getAttribute: operation("GET", "/admin/attributes/{id}", [200], "catalog.read"),
  updateAttribute: operation("PATCH", "/admin/attributes/{id}", [200], "catalog.write", {
    hasBody: true,
  }),
  deleteAttribute: operation("DELETE", "/admin/attributes/{id}", [204], "catalog.write"),
  createAttributeOption: operation(
    "POST",
    "/admin/attributes/{id}/options",
    [201],
    "catalog.write",
    { hasBody: true },
  ),
  updateAttributeOption: operation(
    "PATCH",
    "/admin/attributes/{id}/options/{optionId}",
    [200],
    "catalog.write",
    { hasBody: true },
  ),
  deleteAttributeOption: operation(
    "DELETE",
    "/admin/attributes/{id}/options/{optionId}",
    [204],
    "catalog.write",
  ),
  createBrand: operation("POST", "/admin/brands", [201], "catalog.write", { hasBody: true }),
  listBrands: operation("GET", "/admin/brands", [200], "catalog.read", {
    query: ["limit", "offset"],
  }),
  getBrand: operation("GET", "/admin/brands/{id}", [200], "catalog.read"),
  updateBrand: operation("PATCH", "/admin/brands/{id}", [200], "catalog.write", { hasBody: true }),
  deleteBrand: operation("DELETE", "/admin/brands/{id}", [204], "catalog.write"),
  createCategory: operation("POST", "/admin/categories", [201], "catalog.write", { hasBody: true }),
  listCategories: operation("GET", "/admin/categories", [200], "catalog.read", {
    query: ["parentId", "limit", "offset"],
  }),
  getCategory: operation("GET", "/admin/categories/{id}", [200], "catalog.read"),
  updateCategory: operation("PATCH", "/admin/categories/{id}", [200], "catalog.write", {
    hasBody: true,
  }),
  deleteCategory: operation("DELETE", "/admin/categories/{id}", [204], "catalog.write"),
  moveCategory: operation("POST", "/admin/categories/{id}/move", [200], "catalog.write", {
    hasBody: true,
  }),
  createOption: operation("POST", "/admin/options", [201], "catalog.write", { hasBody: true }),
  listOptions: operation("GET", "/admin/options", [200], "catalog.read", {
    query: ["limit", "offset"],
  }),
  getOption: operation("GET", "/admin/options/{id}", [200], "catalog.read"),
  updateOption: operation("PATCH", "/admin/options/{id}", [200], "catalog.write", {
    hasBody: true,
  }),
  deleteOption: operation("DELETE", "/admin/options/{id}", [204], "catalog.write"),
  createOptionValue: operation("POST", "/admin/options/{id}/values", [201], "catalog.write", {
    hasBody: true,
  }),
  updateOptionValue: operation(
    "PATCH",
    "/admin/options/{id}/values/{valueId}",
    [200],
    "catalog.write",
    { hasBody: true },
  ),
  deleteOptionValue: operation(
    "DELETE",
    "/admin/options/{id}/values/{valueId}",
    [204],
    "catalog.write",
  ),
  createProductType: operation("POST", "/admin/product-types", [201], "catalog.write", {
    hasBody: true,
  }),
  listProductTypes: operation("GET", "/admin/product-types", [200], "catalog.read", {
    query: ["limit", "offset"],
  }),
  getProductType: operation("GET", "/admin/product-types/{id}", [200], "catalog.read"),
  updateProductType: operation("PATCH", "/admin/product-types/{id}", [200], "catalog.write", {
    hasBody: true,
  }),
  deleteProductType: operation("DELETE", "/admin/product-types/{id}", [204], "catalog.write"),
  putProductTypeAttribute: operation(
    "PUT",
    "/admin/product-types/{id}/attributes/{attributeId}",
    [200, 201],
    "catalog.write",
    { hasBody: true },
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
    { hasBody: true },
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
    hasBody: true,
  }),
  putVariantPrice: operation(
    "PUT",
    "/admin/products/{id}/variants/{variantId}/prices/{currency}",
    [200, 201],
    "catalog.write",
    { hasBody: true },
  ),
  deleteVariantPrice: operation(
    "DELETE",
    "/admin/products/{id}/variants/{variantId}/prices/{currency}",
    [204],
    "catalog.write",
  ),
  createProduct: operation("POST", "/admin/products", [201], "catalog.write", { hasBody: true }),
  listProducts: operation("GET", "/admin/products", [200], "catalog.read", {
    query: ["q", "brandId", "categoryId", "status", "limit", "offset"],
  }),
  getProduct: operation("GET", "/admin/products/{id}", [200], "catalog.read"),
  updateProduct: operation("PATCH", "/admin/products/{id}", [200], "catalog.write", {
    hasBody: true,
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
    { hasBody: true },
  ),
  putProductMedia: operation("PUT", "/admin/products/{id}/media", [200], "catalog.write", {
    hasBody: true,
  }),
  putProductOptions: operation("PUT", "/admin/products/{id}/options", [200], "catalog.write", {
    hasBody: true,
  }),
  addProductOptionValue: operation(
    "POST",
    "/admin/products/{id}/options/{optionId}/values",
    [201],
    "catalog.write",
    { hasBody: true },
  ),
  listVariants: operation("GET", "/admin/products/{id}/variants", [200], "catalog.read", {
    query: ["limit", "offset"],
  }),
  createVariant: operation("POST", "/admin/products/{id}/variants", [201], "catalog.write", {
    hasBody: true,
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
    { hasBody: true },
  ),
  deleteVariant: operation(
    "DELETE",
    "/admin/products/{id}/variants/{variantId}",
    [204],
    "catalog.write",
  ),
} as const satisfies Record<string, AdminOperationSpec>;

export type AdminOperationName = keyof typeof ADMIN_OPERATIONS;
