import { ADMIN_OPERATIONS, type AdminOperationName } from "./admin-operations.js";
import type {
  AddProductOptionValueBody,
  AdjustInventoryBody,
  AdjustInventoryResult,
  AdminAttribute,
  AdminAttributeList,
  AdminAttributeOption,
  AdminAttributeWithOptions,
  AdminBrand,
  AdminBrandList,
  AdminCategory,
  AdminCategoryList,
  AdminChangePasswordBody,
  AdminConfig,
  AdminCustomer,
  AdminCustomerList,
  AdminLocationList,
  AdminLoginBody,
  AdminLoginResult,
  AdminMe,
  AdminMediaUpload,
  AdminOption,
  AdminOptionList,
  AdminOptionValue,
  AdminOptionWithValues,
  AdminOrder,
  AdminOrderList,
  AdminPrice,
  AdminPriceList,
  AdminProduct,
  AdminProductInventory,
  AdminProductList,
  AdminProductType,
  AdminProductTypeAttributeAssignment,
  AdminProductTypeDetail,
  AdminProductTypeList,
  AdminProductTypeOptionAssignment,
  AdminReservationList,
  AdminStockMovementList,
  AdminUser,
  AdminUserList,
  AdminVariant,
  AdminVariantInventory,
  AdminVariantList,
  CancelAdminOrderBody,
  CreateAdminAttributeBody,
  CreateAdminAttributeOptionBody,
  CreateAdminBrandBody,
  CreateAdminCategoryBody,
  CreateAdminOptionBody,
  CreateAdminOptionValueBody,
  CreateAdminProductBody,
  CreateAdminProductTypeBody,
  CreateAdminUserBody,
  CreateAdminVariantBody,
  GenerateVariantsResult,
  MarkAdminOrderPaidBody,
  MoveAdminCategoryBody,
  ProductStatus,
  PutProductCategoriesBody,
  PutProductMediaBody,
  PutProductOptionsBody,
  PutProductPricesBody,
  PutProductTypeAttributeBody,
  PutProductTypeOptionBody,
  PutVariantPriceBody,
  ReservationStatus,
  ResetAdminUserPasswordBody,
  UpdateAdminAttributeBody,
  UpdateAdminAttributeOptionBody,
  UpdateAdminBrandBody,
  UpdateAdminCategoryBody,
  UpdateAdminCustomerBody,
  UpdateAdminOptionBody,
  UpdateAdminOptionValueBody,
  UpdateAdminProductBody,
  UpdateAdminProductTypeBody,
  UpdateAdminUserBody,
  UpdateAdminVariantBody,
} from "./admin-types.js";
import { InvalidRequestError } from "./errors.js";
import { BINARY_CONTENT_TYPE, type RawBytes } from "./request.js";
import type { StoreResult } from "./response.js";
import { createTransport, type CallOptions, type CallParts, type FetchLike } from "./transport.js";
import type { OrderStatus } from "./types.js";

export interface AdminClientOptions {
  /** `""` in the browser (the SPA and the API share one origin, ADR 0027); an http(s) origin elsewhere. */
  baseUrl: string;
  /** Defaults to the global `fetch`. */
  fetch?: FetchLike;
}

/** The same value as the store client returns: `{ ok: true, status, data }` or `{ ok: false, status, problem, retryAfter }`. */
export type AdminResult<T> = StoreResult<T>;

/** `limit` and `offset` of every paged list; the API clamps and validates them. */
export interface AdminPageOptions extends CallOptions {
  limit?: number;
  offset?: number;
}

export interface AdminListCustomersOptions extends AdminPageOptions {
  /** The start of the email (case and surrounding spaces do not matter); `%` and `_` are literal. */
  q?: string;
}

export interface AdminListOrdersOptions extends AdminPageOptions {
  /** Only the orders of this customer account (guest orders never match). */
  customerId?: string;
  /** An order number or an exact email. */
  q?: string;
  /** ISO 8601 instant with `Z` or an offset, inclusive. */
  placedFrom?: string;
  /** ISO 8601 instant with `Z` or an offset, exclusive. */
  placedTo?: string;
  status?: OrderStatus;
}

export interface AdminListProductsOptions extends AdminPageOptions {
  /** A slug prefix or an exact SKU (no title search), see `docs/api/catalog.md`. */
  q?: string;
  brandId?: string;
  /** Matches direct category assignments only. */
  categoryId?: string;
  status?: ProductStatus;
}

export interface AdminListCategoriesOptions extends AdminPageOptions {
  parentId?: string;
}

export interface AdminListReservationsOptions extends AdminPageOptions {
  status?: ReservationStatus;
}

type Result<T> = Promise<AdminResult<T>>;

/**
 * One function per operation under `/admin` in `docs/api/openapi.json` (`ADMIN_OPERATIONS`). Path parameters come
 * first in URL order, then the body, then the options (paging and filters, `signal`, `fetchOptions`). Results are
 * values; an answer that cannot be trusted throws (see the README). Nothing is retried.
 */
export interface AdminClient {
  // auth
  login(body: AdminLoginBody, options?: CallOptions): Result<AdminLoginResult>;
  logout(options?: CallOptions): Result<undefined>;
  getMe(options?: CallOptions): Result<AdminMe>;
  changePassword(body: AdminChangePasswordBody, options?: CallOptions): Result<undefined>;

  // users
  listUsers(options?: AdminPageOptions): Result<AdminUserList>;
  createUser(body: CreateAdminUserBody, options?: CallOptions): Result<AdminUser>;
  getUser(id: string, options?: CallOptions): Result<AdminUser>;
  updateUser(id: string, body: UpdateAdminUserBody, options?: CallOptions): Result<AdminUser>;
  resetUserPassword(
    id: string,
    body: ResetAdminUserPasswordBody,
    options?: CallOptions,
  ): Result<undefined>;

  // config
  getConfig(options?: CallOptions): Result<AdminConfig>;

  // media
  /**
   * Uploads one image: the bytes go out as `application/octet-stream` whatever the `Blob`'s own type says, and the
   * server decides the real type by content. The answer carries the `url` to put into a media list or a brand logo.
   * Never retried (an upload is not idempotent; a lost answer leaves one unattached file the server cleans up).
   * `fetch` reports no upload progress, so there is none here: pass `signal` to cancel. `Content-Length` is set by `fetch`.
   */
  uploadMedia(bytes: RawBytes, options?: CallOptions): Result<AdminMediaUpload>;

  // customers
  listCustomers(options?: AdminListCustomersOptions): Result<AdminCustomerList>;
  getCustomer(id: string, options?: CallOptions): Result<AdminCustomer>;
  updateCustomer(
    id: string,
    body: UpdateAdminCustomerBody,
    options?: CallOptions,
  ): Result<AdminCustomer>;
  unlockCustomer(id: string, options?: CallOptions): Result<undefined>;

  // inventory and locations
  getProductInventory(id: string, options?: CallOptions): Result<AdminProductInventory>;
  getVariantInventory(
    id: string,
    variantId: string,
    options?: CallOptions,
  ): Result<AdminVariantInventory>;
  /** A stock change is never retried by the client: reload the level and the journal after a failure (plan, answer 12). */
  adjustInventory(
    id: string,
    variantId: string,
    body: AdjustInventoryBody,
    options?: CallOptions,
  ): Result<AdjustInventoryResult>;
  listStockMovements(
    id: string,
    variantId: string,
    options?: AdminPageOptions,
  ): Result<AdminStockMovementList>;
  listReservations(
    id: string,
    variantId: string,
    options?: AdminListReservationsOptions,
  ): Result<AdminReservationList>;
  listLocations(options?: CallOptions): Result<AdminLocationList>;

  // orders
  listOrders(options?: AdminListOrdersOptions): Result<AdminOrderList>;
  getOrder(id: string, options?: CallOptions): Result<AdminOrder>;
  cancelOrder(id: string, body: CancelAdminOrderBody, options?: CallOptions): Result<AdminOrder>;
  markOrderPaid(
    id: string,
    body: MarkAdminOrderPaidBody,
    options?: CallOptions,
  ): Result<AdminOrder>;
  markOrderFulfilled(id: string, options?: CallOptions): Result<AdminOrder>;

  // attributes
  createAttribute(body: CreateAdminAttributeBody, options?: CallOptions): Result<AdminAttribute>;
  listAttributes(options?: AdminPageOptions): Result<AdminAttributeList>;
  getAttribute(id: string, options?: CallOptions): Result<AdminAttributeWithOptions>;
  updateAttribute(
    id: string,
    body: UpdateAdminAttributeBody,
    options?: CallOptions,
  ): Result<AdminAttribute>;
  deleteAttribute(id: string, options?: CallOptions): Result<undefined>;
  createAttributeOption(
    id: string,
    body: CreateAdminAttributeOptionBody,
    options?: CallOptions,
  ): Result<AdminAttributeOption>;
  updateAttributeOption(
    id: string,
    optionId: string,
    body: UpdateAdminAttributeOptionBody,
    options?: CallOptions,
  ): Result<AdminAttributeOption>;
  deleteAttributeOption(id: string, optionId: string, options?: CallOptions): Result<undefined>;

  // brands
  createBrand(body: CreateAdminBrandBody, options?: CallOptions): Result<AdminBrand>;
  listBrands(options?: AdminPageOptions): Result<AdminBrandList>;
  getBrand(id: string, options?: CallOptions): Result<AdminBrand>;
  updateBrand(id: string, body: UpdateAdminBrandBody, options?: CallOptions): Result<AdminBrand>;
  deleteBrand(id: string, options?: CallOptions): Result<undefined>;

  // categories
  createCategory(body: CreateAdminCategoryBody, options?: CallOptions): Result<AdminCategory>;
  listCategories(options?: AdminListCategoriesOptions): Result<AdminCategoryList>;
  getCategory(id: string, options?: CallOptions): Result<AdminCategory>;
  updateCategory(
    id: string,
    body: UpdateAdminCategoryBody,
    options?: CallOptions,
  ): Result<AdminCategory>;
  deleteCategory(id: string, options?: CallOptions): Result<undefined>;
  moveCategory(
    id: string,
    body: MoveAdminCategoryBody,
    options?: CallOptions,
  ): Result<AdminCategory>;

  // options
  createOption(body: CreateAdminOptionBody, options?: CallOptions): Result<AdminOption>;
  listOptions(options?: AdminPageOptions): Result<AdminOptionList>;
  getOption(id: string, options?: CallOptions): Result<AdminOptionWithValues>;
  updateOption(id: string, body: UpdateAdminOptionBody, options?: CallOptions): Result<AdminOption>;
  deleteOption(id: string, options?: CallOptions): Result<undefined>;
  createOptionValue(
    id: string,
    body: CreateAdminOptionValueBody,
    options?: CallOptions,
  ): Result<AdminOptionValue>;
  updateOptionValue(
    id: string,
    valueId: string,
    body: UpdateAdminOptionValueBody,
    options?: CallOptions,
  ): Result<AdminOptionValue>;
  deleteOptionValue(id: string, valueId: string, options?: CallOptions): Result<undefined>;

  // product types
  createProductType(
    body: CreateAdminProductTypeBody,
    options?: CallOptions,
  ): Result<AdminProductType>;
  listProductTypes(options?: AdminPageOptions): Result<AdminProductTypeList>;
  getProductType(id: string, options?: CallOptions): Result<AdminProductTypeDetail>;
  updateProductType(
    id: string,
    body: UpdateAdminProductTypeBody,
    options?: CallOptions,
  ): Result<AdminProductType>;
  deleteProductType(id: string, options?: CallOptions): Result<undefined>;
  /** `201` when the attribute was newly assigned, `200` when an assignment was updated; read `status`. */
  putProductTypeAttribute(
    id: string,
    attributeId: string,
    body: PutProductTypeAttributeBody,
    options?: CallOptions,
  ): Result<AdminProductTypeAttributeAssignment>;
  removeProductTypeAttribute(
    id: string,
    attributeId: string,
    options?: CallOptions,
  ): Result<undefined>;
  /** `201` when newly assigned, `200` when updated. */
  putProductTypeOption(
    id: string,
    optionId: string,
    body: PutProductTypeOptionBody,
    options?: CallOptions,
  ): Result<AdminProductTypeOptionAssignment>;
  removeProductTypeOption(id: string, optionId: string, options?: CallOptions): Result<undefined>;

  // prices
  listVariantPrices(id: string, variantId: string, options?: CallOptions): Result<AdminPriceList>;
  listProductPrices(id: string, options?: CallOptions): Result<AdminPriceList>;
  putProductPrices(
    id: string,
    body: PutProductPricesBody,
    options?: CallOptions,
  ): Result<AdminPriceList>;
  /** `201` for a new price, `200` for a changed one. `currency` is the ISO 4217 code in the path. */
  putVariantPrice(
    id: string,
    variantId: string,
    currency: string,
    body: PutVariantPriceBody,
    options?: CallOptions,
  ): Result<AdminPrice>;
  deleteVariantPrice(
    id: string,
    variantId: string,
    currency: string,
    options?: CallOptions,
  ): Result<undefined>;

  // products
  createProduct(body: CreateAdminProductBody, options?: CallOptions): Result<AdminProduct>;
  listProducts(options?: AdminListProductsOptions): Result<AdminProductList>;
  getProduct(id: string, options?: CallOptions): Result<AdminProduct>;
  updateProduct(
    id: string,
    body: UpdateAdminProductBody,
    options?: CallOptions,
  ): Result<AdminProduct>;
  deleteProduct(id: string, options?: CallOptions): Result<undefined>;
  publishProduct(id: string, options?: CallOptions): Result<AdminProduct>;
  unpublishProduct(id: string, options?: CallOptions): Result<AdminProduct>;
  archiveProduct(id: string, options?: CallOptions): Result<AdminProduct>;
  restoreProduct(id: string, options?: CallOptions): Result<AdminProduct>;
  putProductCategories(
    id: string,
    body: PutProductCategoriesBody,
    options?: CallOptions,
  ): Result<AdminProduct>;
  putProductMedia(
    id: string,
    body: PutProductMediaBody,
    options?: CallOptions,
  ): Result<AdminProduct>;
  putProductOptions(
    id: string,
    body: PutProductOptionsBody,
    options?: CallOptions,
  ): Result<AdminProduct>;
  addProductOptionValue(
    id: string,
    optionId: string,
    body: AddProductOptionValueBody,
    options?: CallOptions,
  ): Result<AdminProduct>;

  // variants
  listVariants(id: string, options?: AdminPageOptions): Result<AdminVariantList>;
  createVariant(
    id: string,
    body: CreateAdminVariantBody,
    options?: CallOptions,
  ): Result<AdminVariant>;
  generateVariants(id: string, options?: CallOptions): Result<GenerateVariantsResult>;
  getVariant(id: string, variantId: string, options?: CallOptions): Result<AdminVariant>;
  updateVariant(
    id: string,
    variantId: string,
    body: UpdateAdminVariantBody,
    options?: CallOptions,
  ): Result<AdminVariant>;
  deleteVariant(id: string, variantId: string, options?: CallOptions): Result<undefined>;
}

/**
 * The admin API client. It shares the request builder and the response parser with the store client, so the same
 * rules hold: `X-Fluxkit-CSRF: 1` on every request that is not GET or HEAD (the sign-in included), a JSON content
 * type exactly when there is a JSON body (the upload sends raw bytes as `application/octet-stream`), `credentials: "same-origin"`, one `fetch` per call and never a retry or a replay.
 */
export function createAdminClient(options: AdminClientOptions): AdminClient {
  const send = createTransport(options);

  function call<T>(name: AdminOperationName, parts: CallParts): Result<T> {
    return send<T>(ADMIN_OPERATIONS[name], parts);
  }

  return {
    login: (body, opts) => call("login", { body, options: opts }),
    logout: (opts) => call("logout", { options: opts }),
    getMe: (opts) => call("getMe", { options: opts }),
    changePassword: (body, opts) => call("changePassword", { body, options: opts }),

    listUsers: (opts) => call("listUsers", { options: opts }),
    createUser: (body, opts) => call("createUser", { body, options: opts }),
    getUser: (id, opts) => call("getUser", { pathParams: { id }, options: opts }),
    updateUser: (id, body, opts) => call("updateUser", { pathParams: { id }, body, options: opts }),
    resetUserPassword: (id, body, opts) =>
      call("resetUserPassword", { pathParams: { id }, body, options: opts }),

    getConfig: (opts) => call("getConfig", { options: opts }),

    uploadMedia: async (bytes, opts) => {
      const isBytes =
        bytes instanceof Blob || bytes instanceof ArrayBuffer || bytes instanceof Uint8Array;
      if (!isBytes) {
        throw new InvalidRequestError("uploadMedia takes a Blob, an ArrayBuffer or a Uint8Array.");
      }
      return call<AdminMediaUpload>("uploadMedia", {
        rawBody: { bytes, contentType: BINARY_CONTENT_TYPE },
        options: opts,
      });
    },

    listCustomers: (opts) => call("listCustomers", { options: opts }),
    getCustomer: (id, opts) => call("getCustomer", { pathParams: { id }, options: opts }),
    updateCustomer: (id, body, opts) =>
      call("updateCustomer", { pathParams: { id }, body, options: opts }),
    unlockCustomer: (id, opts) => call("unlockCustomer", { pathParams: { id }, options: opts }),

    getProductInventory: (id, opts) =>
      call("getProductInventory", { pathParams: { id }, options: opts }),
    getVariantInventory: (id, variantId, opts) =>
      call("getVariantInventory", { pathParams: { id, variantId }, options: opts }),
    adjustInventory: (id, variantId, body, opts) =>
      call("adjustInventory", { pathParams: { id, variantId }, body, options: opts }),
    listStockMovements: (id, variantId, opts) =>
      call("listStockMovements", { pathParams: { id, variantId }, options: opts }),
    listReservations: (id, variantId, opts) =>
      call("listReservations", { pathParams: { id, variantId }, options: opts }),
    listLocations: (opts) => call("listLocations", { options: opts }),

    listOrders: (opts) => call("listOrders", { options: opts }),
    getOrder: (id, opts) => call("getOrder", { pathParams: { id }, options: opts }),
    cancelOrder: (id, body, opts) =>
      call("cancelOrder", { pathParams: { id }, body, options: opts }),
    markOrderPaid: (id, body, opts) =>
      call("markOrderPaid", { pathParams: { id }, body, options: opts }),
    markOrderFulfilled: (id, opts) =>
      call("markOrderFulfilled", { pathParams: { id }, options: opts }),

    createAttribute: (body, opts) => call("createAttribute", { body, options: opts }),
    listAttributes: (opts) => call("listAttributes", { options: opts }),
    getAttribute: (id, opts) => call("getAttribute", { pathParams: { id }, options: opts }),
    updateAttribute: (id, body, opts) =>
      call("updateAttribute", { pathParams: { id }, body, options: opts }),
    deleteAttribute: (id, opts) => call("deleteAttribute", { pathParams: { id }, options: opts }),
    createAttributeOption: (id, body, opts) =>
      call("createAttributeOption", { pathParams: { id }, body, options: opts }),
    updateAttributeOption: (id, optionId, body, opts) =>
      call("updateAttributeOption", { pathParams: { id, optionId }, body, options: opts }),
    deleteAttributeOption: (id, optionId, opts) =>
      call("deleteAttributeOption", { pathParams: { id, optionId }, options: opts }),

    createBrand: (body, opts) => call("createBrand", { body, options: opts }),
    listBrands: (opts) => call("listBrands", { options: opts }),
    getBrand: (id, opts) => call("getBrand", { pathParams: { id }, options: opts }),
    updateBrand: (id, body, opts) =>
      call("updateBrand", { pathParams: { id }, body, options: opts }),
    deleteBrand: (id, opts) => call("deleteBrand", { pathParams: { id }, options: opts }),

    createCategory: (body, opts) => call("createCategory", { body, options: opts }),
    listCategories: (opts) => call("listCategories", { options: opts }),
    getCategory: (id, opts) => call("getCategory", { pathParams: { id }, options: opts }),
    updateCategory: (id, body, opts) =>
      call("updateCategory", { pathParams: { id }, body, options: opts }),
    deleteCategory: (id, opts) => call("deleteCategory", { pathParams: { id }, options: opts }),
    moveCategory: (id, body, opts) =>
      call("moveCategory", { pathParams: { id }, body, options: opts }),

    createOption: (body, opts) => call("createOption", { body, options: opts }),
    listOptions: (opts) => call("listOptions", { options: opts }),
    getOption: (id, opts) => call("getOption", { pathParams: { id }, options: opts }),
    updateOption: (id, body, opts) =>
      call("updateOption", { pathParams: { id }, body, options: opts }),
    deleteOption: (id, opts) => call("deleteOption", { pathParams: { id }, options: opts }),
    createOptionValue: (id, body, opts) =>
      call("createOptionValue", { pathParams: { id }, body, options: opts }),
    updateOptionValue: (id, valueId, body, opts) =>
      call("updateOptionValue", { pathParams: { id, valueId }, body, options: opts }),
    deleteOptionValue: (id, valueId, opts) =>
      call("deleteOptionValue", { pathParams: { id, valueId }, options: opts }),

    createProductType: (body, opts) => call("createProductType", { body, options: opts }),
    listProductTypes: (opts) => call("listProductTypes", { options: opts }),
    getProductType: (id, opts) => call("getProductType", { pathParams: { id }, options: opts }),
    updateProductType: (id, body, opts) =>
      call("updateProductType", { pathParams: { id }, body, options: opts }),
    deleteProductType: (id, opts) =>
      call("deleteProductType", { pathParams: { id }, options: opts }),
    putProductTypeAttribute: (id, attributeId, body, opts) =>
      call("putProductTypeAttribute", { pathParams: { id, attributeId }, body, options: opts }),
    removeProductTypeAttribute: (id, attributeId, opts) =>
      call("removeProductTypeAttribute", { pathParams: { id, attributeId }, options: opts }),
    putProductTypeOption: (id, optionId, body, opts) =>
      call("putProductTypeOption", { pathParams: { id, optionId }, body, options: opts }),
    removeProductTypeOption: (id, optionId, opts) =>
      call("removeProductTypeOption", { pathParams: { id, optionId }, options: opts }),

    listVariantPrices: (id, variantId, opts) =>
      call("listVariantPrices", { pathParams: { id, variantId }, options: opts }),
    listProductPrices: (id, opts) =>
      call("listProductPrices", { pathParams: { id }, options: opts }),
    putProductPrices: (id, body, opts) =>
      call("putProductPrices", { pathParams: { id }, body, options: opts }),
    putVariantPrice: (id, variantId, currency, body, opts) =>
      call("putVariantPrice", { pathParams: { id, variantId, currency }, body, options: opts }),
    deleteVariantPrice: (id, variantId, currency, opts) =>
      call("deleteVariantPrice", { pathParams: { id, variantId, currency }, options: opts }),

    createProduct: (body, opts) => call("createProduct", { body, options: opts }),
    listProducts: (opts) => call("listProducts", { options: opts }),
    getProduct: (id, opts) => call("getProduct", { pathParams: { id }, options: opts }),
    updateProduct: (id, body, opts) =>
      call("updateProduct", { pathParams: { id }, body, options: opts }),
    deleteProduct: (id, opts) => call("deleteProduct", { pathParams: { id }, options: opts }),
    publishProduct: (id, opts) => call("publishProduct", { pathParams: { id }, options: opts }),
    unpublishProduct: (id, opts) => call("unpublishProduct", { pathParams: { id }, options: opts }),
    archiveProduct: (id, opts) => call("archiveProduct", { pathParams: { id }, options: opts }),
    restoreProduct: (id, opts) => call("restoreProduct", { pathParams: { id }, options: opts }),
    putProductCategories: (id, body, opts) =>
      call("putProductCategories", { pathParams: { id }, body, options: opts }),
    putProductMedia: (id, body, opts) =>
      call("putProductMedia", { pathParams: { id }, body, options: opts }),
    putProductOptions: (id, body, opts) =>
      call("putProductOptions", { pathParams: { id }, body, options: opts }),
    addProductOptionValue: (id, optionId, body, opts) =>
      call("addProductOptionValue", { pathParams: { id, optionId }, body, options: opts }),

    listVariants: (id, opts) => call("listVariants", { pathParams: { id }, options: opts }),
    createVariant: (id, body, opts) =>
      call("createVariant", { pathParams: { id }, body, options: opts }),
    generateVariants: (id, opts) => call("generateVariants", { pathParams: { id }, options: opts }),
    getVariant: (id, variantId, opts) =>
      call("getVariant", { pathParams: { id, variantId }, options: opts }),
    updateVariant: (id, variantId, body, opts) =>
      call("updateVariant", { pathParams: { id, variantId }, body, options: opts }),
    deleteVariant: (id, variantId, opts) =>
      call("deleteVariant", { pathParams: { id, variantId }, options: opts }),
  };
}
