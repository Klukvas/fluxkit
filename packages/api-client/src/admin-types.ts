/**
 * Hand-written request and response types of the admin API (`/admin/*`).
 *
 * Same rules as `types.ts`: written by hand because the generator does not accept the pinned TypeScript, and compared
 * with `docs/api/openapi.json` by `admin-contract.spec.ts` (keys, required keys, nullability, enums, arrays, unions).
 * Money is an integer in minor units with a currency code, ids are strings (UUIDs), instants are ISO 8601 strings.
 * Types shared with the store client (`Money`, `Address`, `OrderStatus`, `OrderContact`, `ProblemDetails`) live in
 * `types.ts`. When the API changes, change `docs/api/openapi.json` and this file in the same commit.
 */

import type { Address, Money, OrderContact, OrderStatus } from "./types.js";

/** Any JSON value. The API validates attribute values and attribute validation rules against the attribute's input type. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type JsonObject = Record<string, JsonValue>;

/** Translated text: locale code to text. The default locale is required where the API says so. */
export type LocalizedText = Record<string, string>;

/** A page of a list: `total` counts all matches, `limit` and `offset` echo the applied paging. */
export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// ------------------------------------------------------------ auth and users

export type AdminRole = "owner" | "manager" | "viewer";

export type AdminPermission =
  | "catalog.read"
  | "catalog.write"
  | "catalog.publish"
  | "users.manage"
  | "orders.read"
  | "orders.write"
  | "customers.read"
  | "customers.write"
  | "shipping.manage";

export interface AdminLoginBody {
  email: string;
  password: string;
}

/** The user as the session endpoints answer. */
export interface AdminSessionUser {
  id: string;
  email: string;
  role: AdminRole;
  isActive: boolean;
  lastLoginAt: string | null;
}

export interface AdminLoginResult {
  user: AdminSessionUser;
}

export interface AdminMe {
  user: AdminSessionUser;
  permissions: AdminPermission[];
}

export interface AdminChangePasswordBody {
  currentPassword: string;
  newPassword: string;
}

export interface AdminUser extends AdminSessionUser {
  createdAt: string;
  updatedAt: string;
}

export type AdminUserList = Paginated<AdminUser>;

export interface CreateAdminUserBody {
  email: string;
  role: AdminRole;
  password: string;
}

export interface UpdateAdminUserBody {
  role?: AdminRole;
  isActive?: boolean;
}

export interface ResetAdminUserPasswordBody {
  newPassword: string;
}

// ------------------------------------------------------------------- config

export interface AdminSupportedCurrency {
  code: string;
  /** Decimal places of the currency's minor unit (0 for JPY, 2 for UAH, 3 for KWD). */
  exponent: number;
}

export interface AdminConfig {
  defaultLocale: string;
  locales: string[];
  shopCurrency: string;
  currencyExponent: number;
  supportedCurrencies: AdminSupportedCurrency[];
  pricesIncludeTax: boolean;
  lowStockThreshold: number;
  media: AdminMediaConfig;
}

/** The upload limits of the server (ADR 0028), so the SPA can mirror them and hide the controls when uploads are off. */
export interface AdminMediaConfig {
  /** False with `MEDIA_STORAGE_DRIVER=none`: the upload route answers 503 `uploads_disabled`. */
  uploadsEnabled: boolean;
  /** `MEDIA_MAX_BYTES`: the largest file the upload route accepts. */
  maxBytes: number;
  /** The image types an upload may have; decided by content, not by file name. */
  contentTypes: string[];
}

/** The type of a stored upload: always the re-encoded output's, never the uploaded file's. */
export type AdminMediaContentType = "image/jpeg" | "image/png" | "image/webp";

/** The `201` answer of `POST /admin/media/uploads`: put `url` into a product media list or a brand logo. */
export interface AdminMediaUpload {
  id: string;
  url: string;
  contentType: AdminMediaContentType;
  /** Bytes of the stored file. */
  byteSize: number;
  width: number;
  height: number;
  createdAt: string;
}

// ---------------------------------------------------------------- customers

export interface AdminCustomerSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AdminCustomer extends AdminCustomerSummary {
  phone: string | null;
  isLocked: boolean;
  orderCount: number;
  updatedAt: string;
}

export type AdminCustomerList = Paginated<AdminCustomerSummary>;

export interface UpdateAdminCustomerBody {
  isActive: boolean;
}

// ---------------------------------------------------- inventory and locations

export interface AdminInventoryLevel {
  locationId: string;
  locationCode: string;
  onHand: number;
  reserved: number;
  available: number;
}

/** Stock of one variant: one level per location and the sum of what can be sold. */
export interface AdminVariantInventory {
  variantId: string;
  trackInventory: boolean;
  allowBackorder: boolean;
  levels: AdminInventoryLevel[];
  totalAvailable: number;
}

export interface AdminProductInventory {
  items: AdminVariantInventory[];
}

export type StockMovementKind = "receipt" | "adjustment" | "sale" | "return";

/** The kinds a person can book by hand (`sale` is written by orders only). */
export type StockAdjustmentKind = "receipt" | "adjustment" | "return";

export interface AdminStockMovement {
  id: string;
  variantId: string;
  locationId: string;
  locationCode: string;
  kind: StockMovementKind;
  delta: number;
  onHandAfter: number;
  reason: string | null;
  reference: string | null;
  actorId: string | null;
  createdAt: string;
}

export type AdminStockMovementList = Paginated<AdminStockMovement>;

export interface AdjustInventoryBody {
  locationId?: string;
  /** Relative change. Exactly one of `delta` and `setOnHand` is allowed. */
  delta?: number;
  setOnHand?: number;
  kind: StockAdjustmentKind;
  reason?: string | null;
  reference?: string | null;
}

export interface AdjustInventoryResult {
  level: AdminInventoryLevel;
  movement: AdminStockMovement;
}

export type ReservationStatus = "active" | "committed" | "released" | "expired";

export interface AdminReservation {
  status: ReservationStatus;
  quantity: number;
  expiresAt: string;
  reference: string | null;
  orderId: string | null;
  locationCode: string;
  createdAt: string;
}

export type AdminReservationList = Paginated<AdminReservation>;

export interface AdminLocation {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
}

export interface AdminLocationList {
  items: AdminLocation[];
}

// ------------------------------------------------------------------- orders

export interface AdminOrderSummary {
  id: string;
  number: string;
  status: OrderStatus;
  placedAt: string;
  expiresAt: string;
  total: Money;
  currency: string;
  customerId: string | null;
  email: string;
  itemCount: number;
}

export type AdminOrderList = Paginated<AdminOrderSummary>;

/** Status and quantity only; the API never answers a reservation id, a location or a stock figure here. */
export interface AdminOrderItemReservation {
  status: string;
  quantity: number;
}

/** A line as it was at purchase time: titles are snapshots in every locale. */
export interface AdminOrderItem {
  position: number;
  productId: string | null;
  variantId: string | null;
  sku: string;
  productTitle: LocalizedText;
  variantTitle: LocalizedText | null;
  optionValues: { option: LocalizedText; value: LocalizedText }[];
  imageUrl: string | null;
  unitPrice: Money;
  compareAtAmount: number | null;
  quantity: number;
  lineTotal: Money;
  requiresShipping: boolean;
  reservations: AdminOrderItemReservation[];
}

export interface AdminOrderAdjustment {
  kind: string;
  code: string;
  label: LocalizedText;
  amount: Money;
  includedInPrice: boolean;
  source: string | null;
}

export type OrderActorType = "customer" | "guest" | "admin" | "system";

export interface AdminOrderHistoryEntry {
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  actorType: OrderActorType;
  actorAdminId: string | null;
  reason: string | null;
  at: string;
}

export interface AdminOrder {
  id: string;
  number: string;
  status: OrderStatus;
  locale: string;
  currency: string;
  customerId: string | null;
  isGuest: boolean;
  contact: OrderContact;
  shippingAddress: Address | null;
  billingAddress: Address | null;
  items: AdminOrderItem[];
  subtotal: Money;
  shippingTotal: Money;
  discountTotal: Money;
  taxTotal: Money;
  total: Money;
  adjustments: AdminOrderAdjustment[];
  history: AdminOrderHistoryEntry[];
  placedAt: string;
  expiresAt: string;
  paidAt: string | null;
  fulfilledAt: string | null;
  cancelledAt: string | null;
  expiredAt: string | null;
  cancellationReason: string | null;
  paymentReference: string | null;
}

export interface CancelAdminOrderBody {
  reason: string;
}

export interface MarkAdminOrderPaidBody {
  reference: string;
  /** Must equal the order total; the API refuses any other amount. */
  amount: Money;
}

// ---------------------------------------------------------------- attributes

export type AttributeInputType = "text" | "number" | "boolean" | "select" | "multiselect" | "date";

export interface AdminAttribute {
  id: string;
  code: string;
  name: LocalizedText;
  description: LocalizedText | null;
  inputType: AttributeInputType;
  isLocalized: boolean;
  unit: string | null;
  validation: JsonObject;
  isFilterable: boolean;
  isSearchable: boolean;
  isVisibleOnStorefront: boolean;
  isComparable: boolean;
  isSortable: boolean;
  isInternal: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminAttributeOption {
  id: string;
  attributeId: string;
  code: string;
  label: LocalizedText;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminAttributeWithOptions extends AdminAttribute {
  options: AdminAttributeOption[];
}

export type AdminAttributeList = Paginated<AdminAttribute>;

export interface CreateAdminAttributeBody {
  code: string;
  name: LocalizedText;
  description?: LocalizedText;
  inputType: AttributeInputType;
  isLocalized?: boolean;
  unit?: string | null;
  validation?: JsonObject;
  isFilterable?: boolean;
  isSearchable?: boolean;
  isVisibleOnStorefront?: boolean;
  isComparable?: boolean;
  isSortable?: boolean;
  isInternal?: boolean;
}

export interface UpdateAdminAttributeBody {
  name?: LocalizedText;
  description?: LocalizedText | null;
  inputType?: AttributeInputType;
  isLocalized?: boolean;
  unit?: string | null;
  validation?: JsonObject;
  isFilterable?: boolean;
  isSearchable?: boolean;
  isVisibleOnStorefront?: boolean;
  isComparable?: boolean;
  isSortable?: boolean;
  isInternal?: boolean;
}

export interface CreateAdminAttributeOptionBody {
  code: string;
  label: LocalizedText;
  position?: number;
}

export interface UpdateAdminAttributeOptionBody {
  label?: LocalizedText;
  position?: number;
}

// ------------------------------------------------------------------- brands

export interface AdminBrand {
  id: string;
  slug: string;
  name: LocalizedText;
  description: LocalizedText | null;
  logoUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AdminBrandList = Paginated<AdminBrand>;

export interface CreateAdminBrandBody {
  name: LocalizedText;
  description?: LocalizedText;
  logoUrl?: string;
  slug?: string;
}

export interface UpdateAdminBrandBody {
  name?: LocalizedText;
  description?: LocalizedText | null;
  logoUrl?: string | null;
  slug?: string;
}

// --------------------------------------------------------------- categories

export interface AdminCategory {
  id: string;
  parentId: string | null;
  slug: string;
  name: LocalizedText;
  description: LocalizedText | null;
  position: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AdminCategoryList = Paginated<AdminCategory>;

export interface CreateAdminCategoryBody {
  name: LocalizedText;
  description?: LocalizedText;
  slug?: string;
  parentId?: string | null;
  position?: number;
  isActive?: boolean;
}

export interface UpdateAdminCategoryBody {
  name?: LocalizedText;
  description?: LocalizedText | null;
  slug?: string;
  isActive?: boolean;
}

export interface MoveAdminCategoryBody {
  parentId: string | null;
  position?: number;
}

// ------------------------------------------------------------------ options

export interface AdminOption {
  id: string;
  code: string;
  name: LocalizedText;
  createdAt: string;
  updatedAt: string;
}

export interface AdminOptionValue {
  id: string;
  optionId: string;
  code: string;
  label: LocalizedText;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminOptionWithValues extends AdminOption {
  values: AdminOptionValue[];
}

export type AdminOptionList = Paginated<AdminOption>;

export interface CreateAdminOptionBody {
  code: string;
  name: LocalizedText;
}

export interface UpdateAdminOptionBody {
  name?: LocalizedText;
}

export interface CreateAdminOptionValueBody {
  code: string;
  label: LocalizedText;
  position?: number;
}

export interface UpdateAdminOptionValueBody {
  label?: LocalizedText;
  position?: number;
}

// ------------------------------------------------------------ product types

export type ProductTypeAttributeLevel = "product" | "variant";

export interface AdminProductType {
  id: string;
  code: string;
  name: LocalizedText;
  requiresShipping: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AdminProductTypeList = Paginated<AdminProductType>;

/** An attribute assigned to a product type (without the attribute itself). */
export interface AdminProductTypeAttributeAssignment {
  productTypeId: string;
  attributeId: string;
  attributeCode: string;
  level: ProductTypeAttributeLevel;
  isRequired: boolean;
  position: number;
  createdAt: string;
}

/** The detail view embeds each assigned attribute with its options, so a form needs no second request. */
export interface AdminProductTypeAttribute extends AdminProductTypeAttributeAssignment {
  attribute: AdminAttributeWithOptions;
}

export interface AdminProductTypeOptionAssignment {
  productTypeId: string;
  optionId: string;
  optionCode: string;
  position: number;
  createdAt: string;
}

export interface AdminProductTypeDetail extends AdminProductType {
  attributes: AdminProductTypeAttribute[];
  options: AdminProductTypeOptionAssignment[];
}

export interface CreateAdminProductTypeBody {
  code: string;
  name: LocalizedText;
  requiresShipping?: boolean;
}

export interface UpdateAdminProductTypeBody {
  name?: LocalizedText;
  requiresShipping?: boolean;
}

export interface PutProductTypeAttributeBody {
  level: ProductTypeAttributeLevel;
  isRequired?: boolean;
  position?: number;
}

export interface PutProductTypeOptionBody {
  position?: number;
}

// ------------------------------------------------------------------- prices

export interface AdminPrice {
  id: string;
  variantId: string;
  currency: string;
  /** Minor units of `currency`. */
  amount: number;
  compareAtAmount: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminPriceList {
  items: AdminPrice[];
}

export interface PutVariantPriceBody {
  amount: number;
  compareAtAmount?: number | null;
}

export interface PutProductPriceItem {
  variantId: string;
  currency: string;
  amount: number;
  compareAtAmount?: number | null;
}

export interface PutProductPricesBody {
  items: PutProductPriceItem[];
}

// ----------------------------------------------------------------- products

export type ProductStatus = "draft" | "active" | "archived";

/** What a product list answers: no categories, media, variants or options. */
export interface AdminProductSummary {
  id: string;
  productTypeId: string;
  brandId: string | null;
  slug: string;
  title: LocalizedText;
  description: LocalizedText | null;
  status: ProductStatus;
  attributes: JsonObject;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AdminProductList = Paginated<AdminProductSummary>;

export interface AdminProductCategory {
  categoryId: string;
  isPrimary: boolean;
  position: number;
}

export interface AdminProductMedia {
  id: string;
  url: string;
  alt: LocalizedText | null;
  position: number;
  optionId: string | null;
  optionValueId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminVariantOptionValue {
  optionId: string;
  optionCode: string;
  optionValueId: string;
  valueCode: string;
}

export interface AdminVariant {
  id: string;
  sku: string;
  barcode: string | null;
  title: LocalizedText | null;
  optionSignature: string;
  isDefault: boolean;
  isActive: boolean;
  trackInventory: boolean;
  allowBackorder: boolean;
  attributes: JsonObject;
  position: number;
  optionValues: AdminVariantOptionValue[];
  createdAt: string;
  updatedAt: string;
}

export type AdminVariantList = Paginated<AdminVariant>;

export interface AdminProductOptionValue {
  optionValueId: string;
  valueCode: string;
  position: number;
}

export interface AdminProductOption {
  optionId: string;
  optionCode: string;
  position: number;
  values: AdminProductOptionValue[];
}

export interface AdminProduct extends AdminProductSummary {
  categories: AdminProductCategory[];
  media: AdminProductMedia[];
  variants: AdminVariant[];
  options: AdminProductOption[];
}

export interface CreateAdminProductBody {
  productTypeId: string;
  title: LocalizedText;
  description?: LocalizedText;
  brandId?: string | null;
  slug?: string;
  attributes?: JsonObject;
}

export interface UpdateAdminProductBody {
  productTypeId?: string;
  title?: LocalizedText;
  description?: LocalizedText | null;
  brandId?: string | null;
  slug?: string;
  attributes?: JsonObject;
}

export interface PutProductCategoriesBody {
  categories: { categoryId: string; position?: number }[];
  primaryCategoryId?: string | null;
}

export interface PutProductMediaItem {
  url: string;
  alt?: LocalizedText | null;
  position?: number;
  optionId?: string | null;
  optionValueId?: string | null;
}

export interface PutProductMediaBody {
  media: PutProductMediaItem[];
}

export interface PutProductOptionsBody {
  options: { optionId: string; valueIds: string[] }[];
}

export interface AddProductOptionValueBody {
  valueId: string;
}

export interface CreateAdminVariantBody {
  optionValueIds: string[];
  sku?: string;
  barcode?: string | null;
  attributes?: JsonObject;
  isActive?: boolean;
  trackInventory?: boolean;
  allowBackorder?: boolean;
}

export interface UpdateAdminVariantBody {
  sku?: string;
  barcode?: string | null;
  attributes?: JsonObject;
  isActive?: boolean;
  trackInventory?: boolean;
  allowBackorder?: boolean;
  position?: number;
  isDefault?: boolean;
}

export interface GenerateVariantsResult {
  created: number;
  skipped: number;
  variants: AdminVariant[];
}
