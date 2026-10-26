import { InvalidRequestError } from "./errors.js";
import { OPERATIONS, type OperationName } from "./operations.js";
import type { StoreResult } from "./response.js";
import { createTransport, type CallOptions, type CallParts, type FetchLike } from "./transport.js";
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
  PasswordResetAccepted,
  PasswordResetConfirmBody,
  PasswordResetRequestBody,
  ProductDetail,
  ProductList,
  PickupPointKind,
  RegisterBody,
  SetCartItemQuantityBody,
  ShippingCityPage,
  ShippingOptions,
  ShippingPickupPointPage,
  StoreConfig,
  UpdateAccountBody,
  VerifyEmailBody,
} from "./types.js";

export interface StoreClientOptions {
  /** `""` in the browser (one origin, the reverse proxy or the dev rewrite routes `/store/*`); `API_INTERNAL_URL` on the server. */
  baseUrl: string;
  /** Defaults to the global `fetch`. */
  fetch?: FetchLike;
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

export interface ShippingOptionsOptions extends LocaleOptions {
  /** The destination country of the address the shopper entered (ISO 3166-1 alpha-2). */
  country?: string;
  /** A city of a provider: asks for the carrier's estimate. */
  cityRef?: string;
  /** A pickup point of a provider: its country and the carrier's estimate. */
  pickupPointRef?: string;
}

export interface ShippingLookupOptions extends LocaleOptions {
  limit?: number;
  offset?: number;
}

export interface ShippingPickupPointsOptions extends CallOptions {
  /** Filters by number or description. */
  q?: string;
  /** Both kinds when missing. */
  kinds?: readonly PickupPointKind[];
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
  /**
   * Asks for a reset link by mail. Always `202 {}` for any address (no account enumeration); `404` without a mail
   * provider (`getConfig().emailDelivery` is false then).
   */
  requestPasswordReset(
    body: PasswordResetRequestBody,
    options?: CallOptions,
  ): Result<PasswordResetAccepted>;
  /** Sets a new password with the link's token; every token problem is one `400` at `token` (`invalid_or_expired`). */
  confirmPasswordReset(body: PasswordResetConfirmBody, options?: CallOptions): Result<undefined>;
  /** Confirms the account's address with the link's token (`204`, also again for a verified customer). */
  confirmEmailVerification(body: VerifyEmailBody, options?: CallOptions): Result<undefined>;
  /** Sends the signed-in customer a new verification link (`409 already_verified` when verified). */
  requestEmailVerification(options?: CallOptions): Result<undefined>;
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
  /** The shipping methods for the current cart (cookie or session), priced by the server; `no-store`. */
  getShippingOptions(options?: ShippingOptionsOptions): Result<ShippingOptions>;
  /** City search of a provider (`query`: 2 to 50 characters). */
  listShippingCities(
    providerCode: string,
    query: string,
    options?: ShippingLookupOptions,
  ): Result<ShippingCityPage>;
  /** The pickup points of a provider's city. */
  listShippingPickupPoints(
    providerCode: string,
    cityRef: string,
    options?: ShippingPickupPointsOptions,
  ): Result<ShippingPickupPointPage>;
}

/** Header-safe: visible ASCII only, so a key can never inject a header or be silently altered. */
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,255}$/;

export function createStoreClient(options: StoreClientOptions): StoreClient {
  const send = createTransport(options);

  function call<T>(name: OperationName, parts: CallParts): Result<T> {
    return send<T>(OPERATIONS[name], parts);
  }

  return {
    register: (body, opts) => call("register", { body, options: opts }),
    login: (body, opts) => call("login", { body, options: opts }),
    logout: (opts) => call("logout", { options: opts }),
    getAccount: (opts) => call("getAccount", { options: opts }),
    updateAccount: (body, opts) => call("updateAccount", { body, options: opts }),
    changePassword: (body, opts) => call("changePassword", { body, options: opts }),
    requestPasswordReset: (body, opts) => call("requestPasswordReset", { body, options: opts }),
    confirmPasswordReset: (body, opts) => call("confirmPasswordReset", { body, options: opts }),
    confirmEmailVerification: (body, opts) =>
      call("confirmEmailVerification", { body, options: opts }),
    requestEmailVerification: (opts) => call("requestEmailVerification", { options: opts }),
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
    getShippingOptions: (opts) => call("getShippingOptions", { options: opts }),
    listShippingCities: (providerCode, query, opts) =>
      call("listShippingCities", {
        pathParams: { code: providerCode },
        options: { ...opts, q: query } as CallOptions,
      }),
    listShippingPickupPoints: (providerCode, cityRef, opts) => {
      const { kinds, ...rest } = opts ?? {};
      return call("listShippingPickupPoints", {
        pathParams: { code: providerCode },
        options: {
          ...rest,
          cityRef,
          ...(kinds === undefined ? {} : { kinds: kinds.join(",") }),
        } as CallOptions,
      });
    },
  };
}
