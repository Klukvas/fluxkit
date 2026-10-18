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
  | "service_unavailable";

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

export interface OrderContact {
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
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
  /** `null` when the order has nothing to ship. */
  shippingAddress: Address | null;
  billingAddress: Address | null;
  history: OrderHistoryEntry[];
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
  /** The total the shopper saw; the server answers `cart_changed` when it differs. */
  expectedTotal: Money;
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
