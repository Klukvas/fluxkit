import { InvalidRequestError, NetworkError } from "./errors.js";
import { OPERATIONS, type OperationName } from "./operations.js";
import { buildRequest, normalizeBaseUrl, type QueryValue } from "./request.js";
import { parseResponse, type StoreResult } from "./response.js";
import type {
  AccountResult,
  AddCartItemBody,
  AuthResult,
  Cart,
  CategoryList,
  ChangePasswordBody,
  CheckoutBody,
  CheckoutResult,
  LoginBody,
  Order,
  OrderAccessBody,
  OrderList,
  ProductDetail,
  ProductList,
  RegisterBody,
  SetCartItemQuantityBody,
  StoreConfig,
  UpdateAccountBody,
} from "./types.js";

/** The part of `fetch` the client uses; tests inject a fake. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface StoreClientOptions {
  /** `""` in the browser (one origin, the reverse proxy or the dev rewrite routes `/store/*`); `API_INTERNAL_URL` on the server. */
  baseUrl: string;
  /** Defaults to the global `fetch`. */
  fetch?: FetchLike;
}

export interface CallOptions {
  signal?: AbortSignal;
  /** Extra `fetch` options such as Next's `{ next: { revalidate: 60 } }`. Cannot change method, headers, body or credentials. */
  fetchOptions?: Readonly<Record<string, unknown>>;
}

export interface LocaleOptions extends CallOptions {
  locale?: string;
}

export interface ListProductsOptions extends LocaleOptions {
  brand?: string;
  category?: string;
  offset?: number;
  limit?: number;
}

export interface ListOrdersOptions extends LocaleOptions {
  limit?: number;
  offset?: number;
}

export interface CheckoutOptions extends CallOptions {
  /** One key per checkout request body; reuse it for every retry of the same body (ADR 0026). */
  idempotencyKey: string;
}

type Result<T> = Promise<StoreResult<T>>;

/** One function per operation under `/store` in `docs/api/openapi.json`. Results are values; broken answers throw. */
export interface StoreClient {
  register(body: RegisterBody, options?: CallOptions): Result<AuthResult>;
  login(body: LoginBody, options?: CallOptions): Result<AuthResult>;
  logout(options?: CallOptions): Result<undefined>;
  getAccount(options?: CallOptions): Result<AccountResult>;
  updateAccount(body: UpdateAccountBody, options?: CallOptions): Result<AccountResult>;
  changePassword(body: ChangePasswordBody, options?: CallOptions): Result<undefined>;
  getCart(options?: LocaleOptions): Result<Cart>;
  clearCart(options?: CallOptions): Result<undefined>;
  addCartItem(body: AddCartItemBody, options?: LocaleOptions): Result<Cart>;
  setCartItemQuantity(
    variantId: string,
    body: SetCartItemQuantityBody,
    options?: LocaleOptions,
  ): Result<Cart>;
  removeCartItem(variantId: string, options?: LocaleOptions): Result<Cart>;
  acknowledgeCart(options?: LocaleOptions): Result<Cart>;
  /** Refuses (throws) a missing or empty `idempotencyKey` before anything is sent. */
  checkout(body: CheckoutBody, options: CheckoutOptions): Result<CheckoutResult>;
  /** Guest order lookup. The access token travels in the POST body only. */
  lookupOrder(body: OrderAccessBody, options?: LocaleOptions): Result<Order>;
  /** Guest order cancel. The access token travels in the POST body only. */
  cancelOrder(body: OrderAccessBody, options?: LocaleOptions): Result<Order>;
  listAccountOrders(options?: ListOrdersOptions): Result<OrderList>;
  getAccountOrder(number: string, options?: LocaleOptions): Result<Order>;
  cancelAccountOrder(number: string, options?: LocaleOptions): Result<Order>;
  listCategories(options?: LocaleOptions): Result<CategoryList>;
  getConfig(options?: CallOptions): Result<StoreConfig>;
  listProducts(options?: ListProductsOptions): Result<ProductList>;
  getProduct(slug: string, options?: LocaleOptions): Result<ProductDetail>;
}

/** Header-safe: visible ASCII only, so a key can never inject a header or be silently altered. */
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,255}$/;

function isAbort(cause: unknown, signal: AbortSignal | undefined): boolean {
  return (
    signal?.aborted === true ||
    (typeof cause === "object" &&
      cause !== null &&
      (cause as { name?: unknown }).name === "AbortError")
  );
}

export function createStoreClient(options: StoreClientOptions): StoreClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init));

  async function call<T>(
    name: OperationName,
    parts: {
      pathParams?: Record<string, string>;
      body?: unknown;
      headers?: Record<string, string>;
      options?: CallOptions;
    },
  ): Result<T> {
    const operation = OPERATIONS[name];
    const context = `${operation.method} ${operation.path}`;
    const given: Readonly<Record<string, unknown>> = { ...parts.options };
    const query: Record<string, QueryValue> = {};
    for (const key of operation.query) {
      const value = given[key];
      if (typeof value === "string" || typeof value === "number") query[key] = value;
    }

    const request = buildRequest({
      baseUrl,
      method: operation.method,
      path: operation.path,
      ...(parts.pathParams === undefined ? {} : { pathParams: parts.pathParams }),
      query,
      ...(parts.body === undefined ? {} : { body: parts.body }),
      ...(parts.headers === undefined ? {} : { headers: parts.headers }),
      ...(parts.options?.signal === undefined ? {} : { signal: parts.options.signal }),
      ...(parts.options?.fetchOptions === undefined
        ? {}
        : { fetchOptions: parts.options.fetchOptions }),
    });

    let response: Response;
    try {
      response = await fetchImpl(request.url, request.init);
    } catch (cause) {
      throw new NetworkError(`${context}: the request failed before an answer arrived.`, {
        cause,
        aborted: isAbort(cause, parts.options?.signal),
      });
    }
    return parseResponse<T>({ successStatuses: operation.successStatuses, context }, response);
  }

  return {
    register: (body, opts) => call("register", { body, options: opts }),
    login: (body, opts) => call("login", { body, options: opts }),
    logout: (opts) => call("logout", { options: opts }),
    getAccount: (opts) => call("getAccount", { options: opts }),
    updateAccount: (body, opts) => call("updateAccount", { body, options: opts }),
    changePassword: (body, opts) => call("changePassword", { body, options: opts }),
    getCart: (opts) => call("getCart", { options: opts }),
    clearCart: (opts) => call("clearCart", { options: opts }),
    addCartItem: (body, opts) => call("addCartItem", { body, options: opts }),
    setCartItemQuantity: (variantId, body, opts) =>
      call("setCartItemQuantity", { pathParams: { variantId }, body, options: opts }),
    removeCartItem: (variantId, opts) =>
      call("removeCartItem", { pathParams: { variantId }, options: opts }),
    acknowledgeCart: (opts) => call("acknowledgeCart", { options: opts }),
    checkout: async (body, opts) => {
      const key: unknown = (opts as Partial<CheckoutOptions> | undefined)?.idempotencyKey;
      if (typeof key !== "string" || !IDEMPOTENCY_KEY.test(key)) {
        throw new InvalidRequestError(
          "POST /store/checkout needs an idempotencyKey (1 to 255 visible ASCII characters).",
        );
      }
      return call("checkout", { body, headers: { "Idempotency-Key": key }, options: opts });
    },
    lookupOrder: (body, opts) => call("lookupOrder", { body, options: opts }),
    cancelOrder: (body, opts) => call("cancelOrder", { body, options: opts }),
    listAccountOrders: (opts) => call("listAccountOrders", { options: opts }),
    getAccountOrder: (number, opts) =>
      call("getAccountOrder", { pathParams: { number }, options: opts }),
    cancelAccountOrder: (number, opts) =>
      call("cancelAccountOrder", { pathParams: { number }, options: opts }),
    listCategories: (opts) => call("listCategories", { options: opts }),
    getConfig: (opts) => call("getConfig", { options: opts }),
    listProducts: (opts) => call("listProducts", { options: opts }),
    getProduct: (slug, opts) => call("getProduct", { pathParams: { slug }, options: opts }),
  };
}
