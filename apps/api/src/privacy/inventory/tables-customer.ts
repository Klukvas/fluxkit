import { classified, many, none } from "./builders.js";
import type { Inventory } from "./types.js";

/** Customer accounts, their sessions, carts, auth tokens, the mail outbox and the event outbox (plan rows D1 to D5, D16, D17). */
export const customerTables: Inventory = {
  customer: {
    id: classified("pseudonymous", "D1", "included", "delete_row"),
    ...many(
      classified("personal", "D1", "included", "delete_row"),
      "email",
      "first_name",
      "last_name",
      "phone",
    ),
    password_hash: classified(
      "secret_hash",
      "D2",
      "excluded",
      "delete_row",
      "A hash is never exported.",
    ),
    ...many(
      classified("pseudonymous", "D2", "included", "delete_row"),
      "is_active",
      "email_verified_at",
      "last_login_at",
      "password_changed_at",
      "created_at",
      "updated_at",
    ),
    ...many(
      classified(
        "pseudonymous",
        "D2",
        "excluded",
        "delete_row",
        "Operational login-protection state, not data the person supplied.",
      ),
      "failed_login_count",
      "locked_until",
    ),
  },

  customer_session: {
    ...none("D3", "id"),
    customer_id: classified(
      "pseudonymous",
      "D3",
      "excluded",
      "cascade",
      "Internal id; the export is already scoped to the subject.",
    ),
    token_hash: classified("secret_hash", "D3", "excluded", "cascade", "A hash is never exported."),
    ...many(classified("pseudonymous", "D3", "included", "cascade"), "created_at", "last_seen_at"),
    expires_at: classified(
      "pseudonymous",
      "D3",
      "excluded",
      "cascade",
      "Derived from the created time and the configured limits.",
    ),
  },

  customer_auth_token: {
    ...none("D4", "id", "purpose", "created_at", "expires_at", "used_at"),
    customer_id: classified(
      "pseudonymous",
      "D4",
      "excluded",
      "cascade",
      "Operational record; the account email is exported from the customer row.",
    ),
    token_hash: classified("secret_hash", "D4", "excluded", "cascade", "A hash is never exported."),
    email: classified(
      "personal",
      "D4",
      "excluded",
      "cascade",
      "Operational record that repeats the account email; purged by job 10.",
    ),
  },

  cart: {
    ...none("D5", "id", "created_at", "updated_at", "expires_at"),
    token_hash: classified("secret_hash", "D5", "excluded", "cascade", "A hash is never exported."),
    customer_id: classified(
      "pseudonymous",
      "D5",
      "excluded",
      "cascade",
      "Internal id; the export is already scoped to the subject.",
    ),
  },

  cart_item: {
    ...none("D5", "id", "cart_id", "created_at", "updated_at"),
    variant_id: classified(
      "pseudonymous",
      "D5",
      "excluded",
      "cascade",
      "Internal id; the export shows the SKU and title of the line.",
    ),
    ...many(
      classified("pseudonymous", "D5", "included", "cascade"),
      "quantity",
      "seen_unit_amount",
      "seen_currency",
    ),
  },

  email_message: {
    ...none(
      "D16",
      "id",
      "template_version",
      "attempts",
      "next_attempt_at",
      "lease_until",
      "deadline_at",
      "provider_code",
      "last_error_code",
      "resend_of",
      "updated_at",
    ),
    to_address: classified(
      "personal",
      "D16",
      "excluded",
      "delete_row",
      "The account email is exported once; the mail export lists template key, status and times only.",
    ),
    variables: classified(
      "personal",
      "D16",
      "excluded",
      "delete_row",
      "Order lines, totals and a tracking number for rendering; no rendered body is stored.",
    ),
    ...many(
      classified("pseudonymous", "D16", "included", "delete_row"),
      "template_key",
      "locale",
      "recipient_kind",
      "status",
      "created_at",
      "sent_at",
    ),
    ...many(
      classified(
        "pseudonymous",
        "D16",
        "excluded",
        "delete_row",
        "Internal id or provider reference only the shop can use.",
      ),
      "customer_id",
      "order_id",
      "dedupe_key",
      "provider_message_id",
    ),
    ...many(
      classified(
        "staff",
        "D20",
        "excluded",
        "set_null",
        "Admin actor id; admin ids are not exported.",
      ),
      "admin_user_id",
      "created_by_admin_id",
    ),
  },

  domain_event: {
    ...none("D17", "id", "type", "created_at", "dispatched_at", "attempts", "last_error_code"),
    ...many(
      classified(
        "pseudonymous",
        "D17",
        "excluded",
        "keep",
        "Ids only, by rule (docs/contracts/events.md); deleted by job 4 seven days after dispatch.",
      ),
      "aggregate_id",
      "payload",
    ),
  },
};
