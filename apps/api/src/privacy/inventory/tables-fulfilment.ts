import { classified, many, none } from "./builders.js";
import type { Inventory } from "./types.js";

const ACCOUNTING =
  "Accounting and delivery record (ADR 0017): never deleted, contains no contact data.";
const INTERNAL = "Internal id or provider reference only the shop can use.";
const ACTOR = "Admin actor id; admin ids are not exported.";

const kept = classified("pseudonymous", "D13", "included", "keep", ACCOUNTING);
const keptInternal = classified("pseudonymous", "D13", "excluded", "keep", INTERNAL);
const paymentKept = classified("pseudonymous", "D14", "included", "keep", ACCOUNTING);
const paymentInternal = classified("pseudonymous", "D14", "excluded", "keep", INTERNAL);
const actorSetNull = classified("staff", "D20", "excluded", "set_null", ACTOR);

/** Shipments, payments, refunds, the stock journal and the carrier sender profile (plan rows D13 to D15, D20 to D22). */
export const fulfilmentTables: Inventory = {
  shipment: {
    ...none("D13", "next_track_at", "tracking_attempts"),
    ...many(keptInternal, "id", "order_id", "provider_ref"),
    ...many(
      kept,
      "provider_code",
      "provider_service",
      "status",
      "carrier_status_code",
      "carrier_status_at",
      "tracking_number",
      "client_reference",
      "declared_value_amount",
      "currency",
      "carrier_cost_amount",
      "payer",
      "weight_grams",
      "length_mm",
      "width_mm",
      "height_mm",
      "seats",
      "created_at",
      "updated_at",
      "cancelled_at",
      "delivered_at",
    ),
    created_by: actorSetNull,
  },

  shipment_status_change: {
    ...many(keptInternal, "id", "shipment_id"),
    ...many(kept, "from_status", "to_status", "carrier_status_code", "actor_type", "created_at"),
    actor_admin_id: actorSetNull,
  },

  shipping_provider_setting: {
    ...none("D22", "provider_code", "updated_at"),
    settings: classified(
      "personal",
      "D22",
      "excluded",
      "out_of_scope",
      "Sender profile of the shop (name, phone, email, company); a sole proprietor is a natural person. The owner edits it; it is not data of a shopper.",
    ),
    updated_by: actorSetNull,
  },

  payment: {
    ...none("D14", "check_attempts", "next_check_at", "needs_attention", "attention_code"),
    ...many(paymentInternal, "id", "order_id", "provider_payment_id", "idempotency_key"),
    redirect_url: classified(
      "pseudonymous",
      "D14",
      "excluded",
      "keep",
      "The provider's hosted payment page address, kept only while the attempt is live; a capability link, never exported.",
    ),
    ...many(
      paymentKept,
      "provider_code",
      "amount",
      "currency",
      "status",
      "provider_status",
      "provider_modified_at",
      "final_amount",
      "refunded_amount",
      "expires_at",
      "order_outcome",
      "failure_code",
      "card_system",
      "card_last4",
      "created_at",
      "updated_at",
    ),
    created_by: actorSetNull,
  },

  payment_event: {
    ...many(paymentInternal, "id", "payment_id", "dedupe_key"),
    ...many(
      paymentKept,
      "source",
      "provider_status",
      "provider_modified_at",
      "amount",
      "final_amount",
      "currency",
      "failure_code",
      "applied",
      "from_status",
      "to_status",
      "created_at",
    ),
    actor_admin_id: actorSetNull,
  },

  payment_refund: {
    ...many(paymentInternal, "id", "payment_id", "idempotency_key"),
    ...many(
      paymentKept,
      "amount",
      "currency",
      "payment_amount",
      "status",
      "reason",
      "provider_modified_at",
      "failure_code",
      "created_at",
      "updated_at",
    ),
    note: classified(
      "free_text",
      "D15",
      "excluded",
      "keep",
      "Admin free text that may name staff (the amounts and statuses are exported); admins are told not to type personal data.",
    ),
    actor_admin_id: actorSetNull,
  },

  stock_movement: {
    ...none(
      "D21",
      "id",
      "variant_id",
      "location_id",
      "delta",
      "kind",
      "on_hand_after",
      "created_at",
    ),
    reason: classified(
      "free_text",
      "D21",
      "excluded",
      "keep",
      "Append-only inventory journal with admin free text; not data about a shopper.",
    ),
    reference: classified(
      "pseudonymous",
      "D21",
      "excluded",
      "keep",
      "May hold an order number; inventory journal, append-only.",
    ),
    actor_id: actorSetNull,
  },

  reservation: {
    ...none(
      "D21",
      "id",
      "variant_id",
      "location_id",
      "quantity",
      "status",
      "expires_at",
      "created_at",
      "updated_at",
    ),
    reference: classified(
      "pseudonymous",
      "D21",
      "excluded",
      "keep",
      "May hold an order number; expires with the reservation.",
    ),
  },
};
