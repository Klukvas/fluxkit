import type { HttpMethod } from "./request.js";

/** One row per operation of the public store API: `docs/api/openapi.json`, every path under `/store`. */
export interface OperationSpec {
  method: HttpMethod;
  /** OpenAPI path template. */
  path: string;
  /** Success statuses the document lists. Every other 2xx is an unexpected answer. */
  successStatuses: readonly number[];
  /** Whether the operation takes a JSON request body. */
  hasBody: boolean;
  /** Query parameter names the document lists. */
  query: readonly string[];
  /** Whether the operation requires the `Idempotency-Key` header (checkout, payment creates). */
  requiresIdempotencyKey: boolean;
}

function operation(
  method: HttpMethod,
  path: string,
  successStatuses: readonly number[],
  options: { hasBody?: boolean; query?: readonly string[]; requiresIdempotencyKey?: boolean } = {},
): OperationSpec {
  return {
    method,
    path,
    successStatuses,
    hasBody: options.hasBody ?? false,
    query: options.query ?? [],
    requiresIdempotencyKey: options.requiresIdempotencyKey ?? false,
  };
}

const LOCALE = ["locale"] as const;

/**
 * The names are the client function names. A test walks `docs/api/openapi.json` and fails when a store operation
 * is missing here, when a row has no operation in the document, or when method, path, statuses, query parameters,
 * body or idempotency header differ. No admin route belongs here.
 */
export const OPERATIONS = {
  register: operation("POST", "/store/account/register", [201], { hasBody: true }),
  login: operation("POST", "/store/account/login", [200], { hasBody: true }),
  logout: operation("POST", "/store/account/logout", [204]),
  getAccount: operation("GET", "/store/account/me", [200]),
  updateAccount: operation("PATCH", "/store/account/me", [200], { hasBody: true }),
  changePassword: operation("POST", "/store/account/change-password", [204], { hasBody: true }),
  getDataExport: operation("GET", "/store/account/data-export", [200]),
  deleteAccount: operation("POST", "/store/account/delete", [204], { hasBody: true }),
  requestPasswordReset: operation("POST", "/store/account/password-reset", [202], {
    hasBody: true,
  }),
  confirmPasswordReset: operation("POST", "/store/account/password-reset/confirm", [204], {
    hasBody: true,
  }),
  confirmEmailVerification: operation("POST", "/store/account/verify-email", [204], {
    hasBody: true,
  }),
  requestEmailVerification: operation("POST", "/store/account/verify-email/resend", [204]),
  getCart: operation("GET", "/store/cart", [200], { query: LOCALE }),
  clearCart: operation("DELETE", "/store/cart", [204]),
  addCartItem: operation("POST", "/store/cart/items", [200], { hasBody: true, query: LOCALE }),
  setCartItemQuantity: operation("PATCH", "/store/cart/items/{variantId}", [200], {
    hasBody: true,
    query: LOCALE,
  }),
  removeCartItem: operation("DELETE", "/store/cart/items/{variantId}", [200], { query: LOCALE }),
  acknowledgeCart: operation("POST", "/store/cart/acknowledge", [200], { query: LOCALE }),
  checkout: operation("POST", "/store/checkout", [201, 200], {
    hasBody: true,
    requiresIdempotencyKey: true,
  }),
  lookupOrder: operation("POST", "/store/orders/lookup", [200], { hasBody: true, query: LOCALE }),
  cancelOrder: operation("POST", "/store/orders/cancel", [200], { hasBody: true, query: LOCALE }),
  listAccountOrders: operation("GET", "/store/account/orders", [200], {
    query: ["locale", "limit", "offset"],
  }),
  getAccountOrder: operation("GET", "/store/account/orders/{number}", [200], { query: LOCALE }),
  cancelAccountOrder: operation("POST", "/store/account/orders/{number}/cancel", [200], {
    query: LOCALE,
  }),
  createOrderPayment: operation("POST", "/store/orders/payments", [201, 200], {
    hasBody: true,
    requiresIdempotencyKey: true,
  }),
  getOrderPaymentStatus: operation("POST", "/store/orders/payments/status", [200], {
    hasBody: true,
  }),
  createAccountOrderPayment: operation(
    "POST",
    "/store/account/orders/{number}/payments",
    [201, 200],
    { hasBody: true, requiresIdempotencyKey: true },
  ),
  getAccountOrderPayment: operation(
    "GET",
    "/store/account/orders/{number}/payments/{paymentId}",
    [200],
  ),
  listCategories: operation("GET", "/store/categories", [200], { query: LOCALE }),
  getConfig: operation("GET", "/store/config", [200]),
  listProducts: operation("GET", "/store/products", [200], {
    query: ["brand", "category", "offset", "limit", "locale"],
  }),
  getProduct: operation("GET", "/store/products/{slug}", [200], { query: LOCALE }),
  searchProducts: operation("GET", "/store/search", [200], {
    query: ["q", "locale", "f", "price", "sort", "page", "limit"],
  }),
  suggestProducts: operation("GET", "/store/search/suggest", [200], { query: ["q", "locale"] }),
  getShippingOptions: operation("GET", "/store/shipping/options", [200], {
    query: ["country", "locale", "cityRef", "pickupPointRef"],
  }),
  listShippingCities: operation("GET", "/store/shipping/providers/{code}/cities", [200], {
    query: ["q", "locale", "limit", "offset"],
  }),
  listShippingPickupPoints: operation(
    "GET",
    "/store/shipping/providers/{code}/pickup-points",
    [200],
    { query: ["cityRef", "q", "kinds", "limit", "offset"] },
  ),
} as const satisfies Record<string, OperationSpec>;

export type OperationName = keyof typeof OPERATIONS;
