/**
 * Hand-written request and response types of the public store API.
 *
 * They are written by hand, not generated, because `openapi-typescript` does not accept the pinned TypeScript 6.0.3
 * (see the package README). `contract.spec.ts` compares every type here with `docs/api/openapi.json` (keys,
 * required keys, nullability, enums, array and union shapes), so a contract change fails a test instead of drifting
 * silently. When the API changes, change `docs/api/openapi.json` and this file in the same commit.
 */

/** Minor units of the shop currency (integer) and its ISO 4217 code. Never a float. */
export interface Money {
  amount: number;
  currency: string;
}

export type Availability = "in_stock" | "low_stock" | "out_of_stock";

export type OrderStatus = "awaiting_payment" | "paid" | "fulfilled" | "cancelled" | "expired";

export interface OptionValueLabel {
  option: string;
  value: string;
}

// ---------------------------------------------------------------- problems

export interface FieldError {
  /** Dotted path of the field, for example `email` or `lines.0`; empty for the whole body. */
  path: string;
  code: string;
  message?: string;
}

export type ProblemCode =
  | "validation_failed"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "in_use"
  | "invalid_transition"
  | "rule_violation"
  | "too_many_requests"
  | "internal_error"
  | "cart_empty"
  | "cart_changed"
  | "checkout_refused"
  | "idempotency_key_reused"
  | "too_many_open_orders"
  | "service_unavailable"
  /** The media file could not be written (disk full, quota, unwritable directory); try again later. */
  | "storage_unavailable"
  /** `MEDIA_STORAGE_DRIVER=none`: uploads are switched off; enter image URLs instead. */
  | "uploads_disabled"
  /** The cart ships goods and the shop has an active shipping method: the checkout must name one. */
  | "shipping_method_required"
  /** The checkout named a shipping method for a cart that ships nothing. */
  | "shipping_not_applicable"
  /** Only the shipping price or the method's availability changed: `shipping` carries the fresh option. */
  | "shipping_changed"
  /** The carrier cannot be reached and nothing usable is cached; only that method or lookup fails (`Retry-After`). */
  | "shipping_provider_unavailable"
  /** The payment provider refused or did not answer (`Retry-After`); the store create routes add `payment`. */
  | "payment_provider_unavailable"
  /** The search engine is down or the first index is still built (`Retry-After`): fall back to the catalog list. */
  | "search_unavailable";

/** The `application/problem+json` body of every error answer. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: ProblemCode;
  detail: string;
  errors?: FieldError[];
  field?: string;
  constraint?: string;
  rule?: string;
  /** The fresh cart of a `cart_changed` answer. */
  cart?: Cart;
  /** The chosen method's fresh option of a `shipping_changed` answer. */
  shipping?: ShippingChanged;
  /** A carrier failure of an admin shipment route: the provider's typed reason. */
  reason?: "unavailable" | "rejected" | "invalid_credentials" | "not_supported";
  /** A carrier failure of an admin shipment route: raw carrier codes, never message text. */
  providerCodes?: string[];
  /**
   * `payment_provider_unavailable` of the store create routes: the attempt and whether a new one is accepted. With
   * `canRetry` false the provider's answer was lost: wait (`Retry-After`) and read the status, never start another.
   */
  payment?: { paymentId: string; status: ShopperPaymentStatus; canRetry: boolean };
}

// -------------------------------------------------------------------- cart

export type CartLineNotice =
  | { code: "price_changed"; previousAmount: Money }
  | { code: "unavailable" }
  | { code: "line_total_out_of_range" }
  | { code: "out_of_stock" };

export interface CartLineImage {
  url: string;
  alt: string | null;
}

export interface CartLine {
  variantId: string;
  productSlug: string;
  sku: string;
  title: string;
  variantTitle: string | null;
  optionValues: OptionValueLabel[];
  image: CartLineImage | null;
  quantity: number;
  /** `null` on an unavailable line. */
  unitPrice: Money | null;
  compareAtAmount: number | null;
  /** `null` on an unavailable line. */
  lineTotal: Money | null;
  availability: Availability;
  notices: CartLineNotice[];
}

export interface CartNotice {
  code: "quantity_capped" | "lines_dropped";
}

export interface Cart {
  lines: CartLine[];
  subtotal: Money;
  total: Money;
  itemCount: number;
  /** False while a line is unavailable or out of range; checkout is refused then. */
  purchasable: boolean;
  /** True when any line ships physical goods: the checkout then needs a shipping address. */
  requiresShipping: boolean;
  notices: CartNotice[];
}

export interface AddCartItemBody {
  variantId: string;
  quantity: number;
}

export interface SetCartItemQuantityBody {
  quantity: number;
}

// ---------------------------------------------------------------- accounts

export interface Customer {
  id: string;
  email: string;
  /** Whether the address was confirmed with a verification link (ADR 0031). Unlocks nothing in v1. */
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  phone: string | null;
  createdAt: string;
}

export interface RegisterBody {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
}

export interface LoginBody {
  email: string;
  password: string;
}

export interface UpdateAccountBody {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
}

export interface ChangePasswordBody {
  currentPassword: string;
  newPassword: string;
}

/**
 * `POST /store/account/password-reset`: the address to send a link to and the language of the mail (one of `LOCALES`).
 * The answer is the same empty object whether or not an account exists.
 */
export interface PasswordResetRequestBody {
  email: string;
  locale: string;
}

/** The empty answer of the reset request (`202 {}`): it says nothing about the account. */
export type PasswordResetAccepted = Record<never, never>;

/** `POST /store/account/password-reset/confirm`: the token from the link's `#t=` fragment and the new password. */
export interface PasswordResetConfirmBody {
  token: string;
  newPassword: string;
}

/** `POST /store/account/verify-email`: the token from the link's `#t=` fragment. */
export interface VerifyEmailBody {
  token: string;
}

/** Answer of register and login: the signed-in customer and what happened to the guest cart that was merged. */
export interface AuthResult {
  customer: Customer;
  cartNotices: CartNotice[];
}

export interface AccountResult {
  customer: Customer;
}

// ------------------------------------------------------------------ orders

export interface Address {
  countryCode: string;
  region?: string;
  city: string;
  postalCode?: string;
  line1: string;
  line2?: string;
  recipientFirstName?: string;
  recipientLastName?: string;
  recipientPhone?: string;
}

/** An address as the shopper types it: validated by the API, so every member is optional here. */
export interface AddressInput {
  countryCode?: string;
  region?: string;
  city?: string;
  postalCode?: string;
  line1?: string;
  line2?: string;
  recipientFirstName?: string;
  recipientLastName?: string;
  recipientPhone?: string;
}

export interface OrderItem {
  sku: string;
  productTitle: string;
  variantTitle: string | null;
  optionValues: OptionValueLabel[];
  imageUrl: string | null;
  unitPrice: Money;
  compareAtAmount: number | null;
  quantity: number;
  lineTotal: Money;
}

export interface OrderAdjustment {
  kind: string;
  code: string;
  label: string;
  amount: Money;
  includedInPrice: boolean;
}

/** All four are null once the contact data was erased (privacy erasure or retention, ADR 0033); otherwise all four are set. */
export interface OrderContact {
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface OrderHistoryEntry {
  status: OrderStatus;
  at: string;
}

export interface Order {
  number: string;
  status: OrderStatus;
  placedAt: string;
  expiresAt: string;
  currency: string;
  items: OrderItem[];
  subtotal: Money;
  shippingTotal: Money;
  discountTotal: Money;
  taxTotal: Money;
  total: Money;
  adjustments: OrderAdjustment[];
  contact: OrderContact;
  /** `null` when the order has nothing to ship (or ships to a store pickup). A pickup point order holds the point's address. */
  shippingAddress: Address | null;
  billingAddress: Address | null;
  /** The shipping method chosen at checkout (immutable snapshot); `null` for an order placed without one. */
  shipping: OrderShipping | null;
  /** The carrier waybills of the order that have a number, oldest first; empty until the shop created one. */
  shipments: OrderShipment[];
  history: OrderHistoryEntry[];
  /** Online payment of the order (ADR 0032): whether a new attempt is possible and the newest attempt. */
  payment: OrderPayment;
}

/**
 * A payment attempt as the shopper sees it: `waiting` (the provider's page is open), `processing` (the order updates by
 * itself), `paid`, `failed` (see the category), `expired` (the invoice ended or a newer attempt replaced it). Never a
 * provider status or text.
 */
export type ShopperPaymentStatus = "waiting" | "processing" | "paid" | "failed" | "expired";

/** Only for `failed` and `expired`; `not_accepted`: the money was taken but the order could not take it (refunded). */
export type ShopperPaymentFailureCategory = "declined" | "expired" | "technical" | "not_accepted";

export interface OrderPayment {
  /** Whether `createOrderPayment` / `createAccountOrderPayment` would start a new attempt now. */
  canPay: boolean;
  /** Enabled providers that take the order currency; empty when online payment is off. */
  providers: string[];
  latest: {
    paymentId: string;
    status: ShopperPaymentStatus;
    failureCategory: ShopperPaymentFailureCategory | null;
    expiresAt: string;
    /** The provider's page while `waiting` ("continue payment"); null otherwise. */
    redirectUrl: string | null;
  } | null;
}

/** `createOrderPayment` (guest): the order as for the lookup; never an amount (the server uses the order total). */
export interface CreateOrderPaymentBody {
  number: string;
  accessToken: string;
  /** Optional while one provider is enabled. */
  provider?: string;
  /** The locale of the return page; the order's when missing. */
  locale?: string;
}

/** `createAccountOrderPayment` (customer): the order comes from the path and the session. */
export interface CreateAccountOrderPaymentBody {
  provider?: string;
  locale?: string;
}

/** `getOrderPaymentStatus` (guest): which attempt to show, under the lookup's ownership check. */
export interface OrderPaymentStatusBody {
  number: string;
  accessToken: string;
  paymentId: string;
}

export interface CreatedPayment {
  paymentId: string;
  status: ShopperPaymentStatus;
  /** Navigate here (`window.location.assign`); null when the attempt is not waiting for the shopper. */
  redirectUrl: string | null;
  expiresAt: string;
}

export interface PaymentState {
  paymentId: string;
  status: ShopperPaymentStatus;
  failureCategory: ShopperPaymentFailureCategory | null;
  expiresAt: string;
  orderStatus: OrderStatus;
  /** Whether a new attempt would be accepted now. */
  canRetry: boolean;
}

export interface OrderSummary {
  number: string;
  status: OrderStatus;
  placedAt: string;
  expiresAt: string;
  total: Money;
  itemCount: number;
}

export interface OrderList {
  items: OrderSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface CheckoutBody {
  /** Required for a guest; a signed-in customer's account email by default. */
  email?: string;
  phone: string;
  firstName: string;
  lastName: string;
  /** Required when the cart `requiresShipping`. */
  shippingAddress?: AddressInput | null;
  billingAddress?: AddressInput | null;
  locale?: string;
  /**
   * The shipping method (docs/api/shipping.md): required when the cart ships goods and the shop has an active method,
   * refused (`shipping_not_applicable`) for a cart that ships nothing. `null` or missing means not sent.
   */
  shipping?: CheckoutShipping | null;
  /**
   * The total the shopper saw: the cart subtotal, or with a shipping method the option's `total`. The server answers
   * `cart_changed` or `shipping_changed` when it differs.
   */
  expectedTotal: Money;
}

export interface CheckoutShipping {
  /** The `methodCode` of a shipping option. */
  methodCode: string;
  /** Required for a `pickup_point` method, refused for the others: a `ref` of the pickup point lookup. */
  pickupPointRef?: string;
}

// ---------------------------------------------------------------- shipping

export type ShippingMethodKind = "address" | "pickup_point" | "store_pickup";
export type ShippingPayer = "shop_charge" | "recipient_on_delivery";

/** The normalized status of a carrier waybill (ADR 0029 decision 7); the carrier's own code is kept beside it. */
export type ShipmentStatus =
  | "pending"
  | "unknown"
  | "created"
  | "in_transit"
  | "arrived"
  | "delivered"
  | "returning"
  | "returned"
  | "cancelled"
  | "failed";

/** A carrier waybill of the shopper's order: only one that has a number, with its normalized status. */
export interface OrderShipment {
  providerCode: string;
  trackingNumber: string;
  status: ShipmentStatus;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
  cancelledAt: string | null;
}
export type PickupPointKind = "branch" | "locker";
export type ShippingUnavailableReason =
  | "inactive"
  | "currency_not_offered"
  | "country_required"
  | "country_not_served"
  | "provider_not_enabled"
  | "pricing_invalid"
  | "total_out_of_range";

/** One method for the current cart, priced by the server (`GET /store/shipping/options`). */
export interface ShippingOption {
  methodCode: string;
  kind: ShippingMethodKind;
  title: string;
  /** For `store_pickup` the pickup instructions. */
  description: string | null;
  providerCode: string | null;
  countryCodes: string[];
  available: boolean;
  /** Only when `available` is false. */
  reason?: ShippingUnavailableReason;
  price: Money | null;
  payer: ShippingPayer | null;
  /** Cart subtotal plus `price`: send it as the checkout's `expectedTotal`. */
  total: Money | null;
  /** The carrier's own price: informational, never charged. */
  estimate: Money | null;
}

export interface ShippingOptions {
  subtotal: Money;
  options: ShippingOption[];
}

/** The `shipping` member of `shipping_changed`: the fresh option, or the method is not offered at all any more. */
export type ShippingChanged =
  | ShippingOption
  | { methodCode: string; available: false; reason: "inactive" | "currency_not_offered" };

export interface ShippingCity {
  ref: string;
  name: string;
  region: string | null;
}

export interface ShippingPickupPoint {
  /** Send it as the checkout's `shipping.pickupPointRef`. */
  ref: string;
  number: string;
  kind: PickupPointKind;
  cityRef: string;
  cityName: string;
  countryCode: string;
  description: string;
  maxWeightGrams: number | null;
}

export interface ShippingLookupPage<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  /** The carrier could not be reached; the data is cached up to 72 hours past its expiry. */
  stale: boolean;
}

export type ShippingCityPage = ShippingLookupPage<ShippingCity>;
export type ShippingPickupPointPage = ShippingLookupPage<ShippingPickupPoint>;

/** The pickup point of a `pickup_point` order: public carrier data. */
export interface OrderPickupPoint {
  providerRef: string;
  number: string;
  kind: PickupPointKind;
  cityRef: string;
  cityName: string;
  description: string;
}

/** The shipping snapshot of an order, the title in the read's locale. */
export interface OrderShipping {
  methodCode: string;
  kind: ShippingMethodKind;
  providerCode: string | null;
  amount: Money;
  payer: ShippingPayer;
  /** The carrier's informational estimate known at checkout; never charged. */
  estimatedCarrierAmount: Money | null;
  destination: OrderPickupPoint | null;
  title: string;
}

export interface CheckoutResult {
  order: Order;
  /** Guest orders only: shown once on the first answer and returned unchanged on a replay. */
  accessToken?: string;
}

/** Lookup and cancel of a guest order. The token goes in the POST body only, never in a URL (ADR 0026). */
export interface OrderAccessBody {
  number: string;
  accessToken: string;
}

// ----------------------------------------------------------------- catalog

export interface CategoryNode {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  children: CategoryNode[];
}

export interface CategoryList {
  items: CategoryNode[];
}

export interface StoreConfig {
  currency: string;
  currencyExponent: number;
  pricesIncludeTax: boolean;
  defaultLocale: string;
  locales: string[];
  /** False when no email provider is configured (`EMAIL_PROVIDER=none`): hide "forgot password" and verification prompts. */
  emailDelivery: boolean;
  /** False when no payment provider is enabled (`PAYMENT_PROVIDERS_ENABLED` empty): orders are paid by hand, show no pay button. */
  onlinePayment: boolean;
  /** False with `SEARCH_ENABLED=false`: the search routes answer 404; show no search box or facets, use the product list. */
  search: boolean;
}

export interface PriceRange {
  from: number;
  to: number;
  currency: string;
}

export interface BrandRef {
  slug: string;
  name: string;
}

export interface ProductSummary {
  id: string;
  slug: string;
  title: string;
  brand: BrandRef | null;
  image: CartLineImage | null;
  publishedAt: string;
  price: PriceRange;
  availability: Availability;
}

/** The public sort names of `GET /store/search` (ADR 0034). */
export type SearchSort = "relevance" | "newest" | "price_asc" | "price_desc";

export interface SearchFacetValue {
  /** The value as it goes into `f` (`<key>:<code>`). */
  code: string;
  /** Null for `true`/`false` values: the storefront words them. */
  label: string | null;
  /** Products with the value; null for variant-level facets (values without counts). */
  count: number | null;
  selected: boolean;
}

export interface SearchFacet {
  /** `brand`, `category`, `inStock`, `opt.<code>` or `attr.<code>`. */
  key: string;
  kind: "slug" | "uuid" | "code" | "boolean" | "range";
  level: "product" | "variant";
  /** Option or attribute name; null for brand, category and inStock. */
  label: string | null;
  counted: boolean;
  values: SearchFacetValue[];
  /** Smallest and largest value of a number attribute; null otherwise. */
  range: { min: number; max: number } | null;
}

/** `GET /store/search`. Items are hydrated from the database, so prices and availability are current. */
export interface SearchResult {
  items: ProductSummary[];
  total: number;
  page: number;
  pageCount: number;
  limit: number;
  sort: SearchSort;
  /** The complete words matched nothing: the items match the last word as a prefix or only some words (show them as partial matches). */
  relaxed: boolean;
  query: { normalized: string };
  facets: SearchFacet[];
  price: { min: number; max: number } | null;
}

export interface SearchSuggestions {
  items: { slug: string; title: string }[];
}

export interface ProductList {
  items: ProductSummary[];
  total: number;
  limit: number;
  offset: number;
}

export type AttributeValue =
  | string
  | boolean
  | { value: number; unit: string | null }
  | { code: string; label: string }
  | { code: string; label: string }[];

export interface AttributeDefinition {
  code: string;
  name: string;
  inputType: "text" | "number" | "boolean" | "select" | "multiselect" | "date";
  isLocalized: boolean;
  unit: string | null;
  isFilterable: boolean;
  isComparable: boolean;
  isSortable: boolean;
  options: { code: string; label: string }[];
}

export interface ProductOptionValue {
  id: string;
  code: string;
  name: string;
}

export interface ProductOption {
  id: string;
  code: string;
  name: string;
  values: ProductOptionValue[];
}

export interface ProductVariant {
  id: string;
  sku: string;
  optionValues: { optionCode: string; valueCode: string }[];
  attributes: Record<string, AttributeValue>;
  price: { amount: number; currency: string; compareAtAmount: number | null };
  availability: Availability;
}

export interface ProductMedia {
  url: string;
  alt: string | null;
  optionValueId: string | null;
}

export interface ProductDetail {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  brand: BrandRef | null;
  publishedAt: string;
  categories: { id: string; slug: string; name: string }[];
  attributes: Record<string, AttributeValue>;
  attributeDefinitions: AttributeDefinition[];
  options: ProductOption[];
  variants: ProductVariant[];
  price: PriceRange;
  availability: Availability;
  media: ProductMedia[];
}

// ---- personal data export (ADR 0033 decision 7; docs/contracts/personal-data-export.md)

export type ExportJsonValue =
  string | number | boolean | null | ExportJsonValue[] | { [key: string]: ExportJsonValue };

export type ExportJsonObject = Record<string, ExportJsonValue>;

/** `fluxkit.personal-data-export/v1`: keys and rules in `docs/contracts/personal-data-export.md`. */
export interface PersonalDataExport {
  format: "fluxkit.personal-data-export/v1";
  generatedAt: string;
  subject: { kind: "customer" | "email" };
  account: ExportJsonObject | null;
  orders: ExportJsonObject[];
  mail: ExportJsonObject[];
  sessions: ExportJsonObject[];
  cart: ExportJsonObject | null;
  processors: { kind: "email" | "payment" | "shipping"; name: string }[];
}

/** `POST /store/account/delete`: the current password and an explicit confirmation. */
export interface DeleteAccountBody {
  password: string;
  confirm: true;
}
