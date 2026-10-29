import { classified, many } from "./builders.js";
import type { Inventory } from "./types.js";

const ACCOUNTING = "Accounting record (ADR 0017): orders are anonymised, never deleted.";
const INTERNAL_ID = "Internal id; the export identifies an order by its number.";

const accountingKept = classified("pseudonymous", "D8", "included", "keep", ACCOUNTING);
const internalIdKept = classified("pseudonymous", "D8", "excluded", "keep", INTERNAL_ID);
const lineKept = classified("pseudonymous", "D11", "included", "keep", ACCOUNTING);
const lineIdKept = classified("pseudonymous", "D11", "excluded", "keep", INTERNAL_ID);

/** Orders and their lines, adjustments, journal and shipping snapshot (plan rows D6 to D12). */
export const orderTables: Inventory = {
  sales_order: {
    ...many(
      classified("personal", "D6", "included", "anonymise"),
      "email",
      "phone",
      "first_name",
      "last_name",
    ),
    ...many(
      classified("personal", "D7", "included", "anonymise"),
      "shipping_address",
      "billing_address",
    ),
    ...many(
      accountingKept,
      "number",
      "status",
      "locale",
      "currency",
      "subtotal_amount",
      "shipping_total",
      "discount_total",
      "tax_total",
      "total_amount",
      "placed_at",
      "expires_at",
      "paid_at",
      "fulfilled_at",
      "cancelled_at",
      "expired_at",
      "created_at",
      "updated_at",
    ),
    ...many(internalIdKept, "id"),
    customer_id: classified(
      "pseudonymous",
      "D8",
      "excluded",
      "set_null",
      "Detached by the customer delete (ADR 0019 foreign key).",
    ),
    ...many(
      classified(
        "secret_hash",
        "D9",
        "excluded",
        "clear",
        "A hash is never exported; the guest link stops working after anonymisation.",
      ),
      "access_token_hash",
      "access_expires_at",
    ),
    idempotency_key: classified(
      "secret_hash",
      "D9",
      "excluded",
      "keep",
      "A random client key with no personal content; a hash is never exported.",
    ),
    request_fingerprint: classified(
      "secret_hash",
      "D9",
      "excluded",
      "anonymise",
      "Unsalted hash of the checkout request: replaced by a hash of random bytes, because it could confirm a guess of the erased contact data.",
    ),
    cancellation_reason: classified("free_text", "D10", "included", "anonymise"),
    contact_erased_at: classified(
      "pseudonymous",
      "D6",
      "included",
      "anonymise",
      "Set by the anonymisation itself (core ORDER_ANONYMISATION_PLAN, set_erased_at): it marks the contact as erased.",
    ),
    payment_reference: classified(
      "free_text",
      "D10",
      "included",
      "keep",
      "Bank or provider reference needed for accounting; the admin UI says not to type names here.",
    ),
  },

  order_item: {
    ...many(lineIdKept, "id", "order_id", "product_id", "variant_id"),
    ...many(
      lineKept,
      "position",
      "sku",
      "product_title",
      "variant_title",
      "option_values",
      "image_url",
      "unit_amount",
      "compare_at_amount",
      "quantity",
      "line_total",
      "currency",
      "requires_shipping",
      "created_at",
    ),
  },

  order_adjustment: {
    ...many(lineIdKept, "id", "order_id"),
    ...many(
      lineKept,
      "kind",
      "code",
      "label",
      "amount",
      "included_in_price",
      "source",
      "created_at",
    ),
  },

  order_status_change: {
    ...many(lineIdKept, "id", "order_id"),
    ...many(lineKept, "from_status", "to_status", "actor_type", "created_at"),
    actor_admin_id: classified(
      "staff",
      "D20",
      "excluded",
      "set_null",
      "Admin actor id; admin ids are not exported.",
    ),
    reason: classified(
      "free_text",
      "D12",
      "included",
      "keep",
      "Append-only journal (ADR 0019); admins are told not to type personal data in reasons. TODO(fluxkit): privacy plan step 3 checks which writers fill it.",
    ),
  },

  order_shipping: {
    ...many(lineIdKept, "order_id", "method_id"),
    ...many(
      lineKept,
      "method_code",
      "kind",
      "provider_code",
      "provider_service",
      "title",
      "amount",
      "currency",
      "payer",
      "estimated_carrier_amount",
      "created_at",
    ),
    destination: classified(
      "pseudonymous",
      "D11",
      "included",
      "keep",
      "Public pickup point data of the carrier, no contact data; a point near home is quasi-identifying but public.",
    ),
  },
};
