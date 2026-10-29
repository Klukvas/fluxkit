/*
 * The anonymisation of an order's contact data as data and as a pure function (ADR 0033 decision 6). The order stays an
 * accounting record: number, status, dates, amounts, lines, adjustments, the shipping snapshot, shipments, payments,
 * refunds and journals are kept. The API applies the returned values in one statement per order, under the order lock;
 * the clock and the randomness are parameters. The columns are the SQL names of `sales_order` (the schema step adds
 * `contact_erased_at`).
 */

export type OrderAnonymisationAction =
  /** The column becomes NULL. */
  | "set_null"
  /** A JSON address shrinks to `{countryCode}` (NULL stays NULL). */
  | "keep_country_code"
  /** The column gets a fresh hash of random bytes, so the old value can no longer confirm a guess. */
  | "replace_with_random_hash"
  /** The column records when the contact was erased. */
  | "set_erased_at";

export interface OrderAnonymisationStep {
  readonly column: string;
  readonly action: OrderAnonymisationAction;
}

export const ORDER_ANONYMISATION_PLAN: readonly OrderAnonymisationStep[] = Object.freeze(
  [
    { column: "email", action: "set_null" },
    { column: "phone", action: "set_null" },
    { column: "first_name", action: "set_null" },
    { column: "last_name", action: "set_null" },
    { column: "shipping_address", action: "keep_country_code" },
    { column: "billing_address", action: "keep_country_code" },
    { column: "cancellation_reason", action: "set_null" },
    { column: "access_token_hash", action: "set_null" },
    { column: "access_expires_at", action: "set_null" },
    { column: "request_fingerprint", action: "replace_with_random_hash" },
    { column: "contact_erased_at", action: "set_erased_at" },
  ].map((step) => Object.freeze(step) as OrderAnonymisationStep),
);

/**
 * Columns of `sales_order` that anonymisation never changes. `payment_reference` stays: it is the bank or provider
 * reference the accounting record needs (the admin UI tells staff not to type names into it).
 */
export const ORDER_COLUMNS_KEPT_ON_ANONYMISATION: readonly string[] = Object.freeze([
  "id",
  "number",
  "status",
  "customer_id",
  "locale",
  "currency",
  "subtotal_amount",
  "shipping_total",
  "discount_total",
  "tax_total",
  "total_amount",
  "idempotency_key",
  "placed_at",
  "expires_at",
  "paid_at",
  "fulfilled_at",
  "cancelled_at",
  "expired_at",
  "payment_reference",
  "created_at",
  "updated_at",
]);

export interface OrderAnonymisationInput {
  /** The stored `shipping_address` JSON, or null. Only its `countryCode` can survive. */
  readonly shippingAddress: unknown;
  readonly billingAddress: unknown;
  /** The stored fingerprint: the replacement must differ from it. */
  readonly requestFingerprint: string;
}

export interface OrderAnonymisationOptions {
  readonly erasedAt: Date;
  /** SHA-256 hex (64 lower-case characters) of random bytes, made by the caller. */
  readonly newFingerprint: string;
}

export interface OrderAnonymisedValues {
  readonly email: null;
  readonly phone: null;
  readonly firstName: null;
  readonly lastName: null;
  readonly shippingAddress: { readonly countryCode: string } | null;
  readonly billingAddress: { readonly countryCode: string } | null;
  readonly cancellationReason: null;
  readonly accessTokenHash: null;
  readonly accessExpiresAt: null;
  readonly requestFingerprint: string;
  readonly contactErasedAt: Date;
}

const COUNTRY_CODE = /^[A-Z]{2}$/;
const FINGERPRINT = /^[0-9a-f]{64}$/;

/** `{countryCode}` for an address object with a valid country code; NULL for NULL and for anything else (drop, never keep a fragment). */
function countryOnly(address: unknown): { readonly countryCode: string } | null {
  if (address === null || typeof address !== "object" || Array.isArray(address)) return null;
  const code = (address as { countryCode?: unknown }).countryCode;
  return typeof code === "string" && COUNTRY_CODE.test(code) ? { countryCode: code } : null;
}

export function planOrderAnonymisation(
  order: OrderAnonymisationInput,
  options: OrderAnonymisationOptions,
): OrderAnonymisedValues {
  if (Number.isNaN(options.erasedAt.getTime())) {
    throw new RangeError("The erasure time is not a valid date");
  }
  if (!FINGERPRINT.test(options.newFingerprint)) {
    throw new RangeError("The new request fingerprint must be 64 lower-case hex characters");
  }
  if (options.newFingerprint === order.requestFingerprint) {
    throw new RangeError("The new request fingerprint must differ from the stored one");
  }
  return {
    email: null,
    phone: null,
    firstName: null,
    lastName: null,
    shippingAddress: countryOnly(order.shippingAddress),
    billingAddress: countryOnly(order.billingAddress),
    cancellationReason: null,
    accessTokenHash: null,
    accessExpiresAt: null,
    requestFingerprint: options.newFingerprint,
    contactErasedAt: new Date(options.erasedAt.getTime()),
  };
}
