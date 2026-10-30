# Data inventory

<!-- Generated from apps/api/src/privacy/inventory by data-inventory-doc.spec.ts. Do not edit by hand: run the command below. -->

Every database column of the core schema with its class, purpose, retention and what an export and an erasure do with it. The source is code: `apps/api/src/privacy/inventory/` (the registry) and, for purpose and retention, the plan rows named in the Row column (`docs/plans/2026-10-29-privacy.md`, "Data inventory"). A spec fails when this file and the registry disagree.

Regenerate after changing the registry: `UPDATE_PRIVACY_DOC=1 pnpm --filter @fluxkit/api exec vitest run src/privacy/inventory/data-inventory-doc.spec.ts`.

Classes: personal (P) identifies a person directly; pseudonymous (Q) identifies through another table or a third party; staff (S) is staff personal data; secret hash (H) is not personal by itself but linkable; free text (F) is admin text that MAY contain personal data; none holds no personal data. Export: `included`, `excluded` (with a reason), `not_applicable`. Erasure: `delete_row`, `cascade`, `anonymise`, `set_null`, `clear`, `keep`, `out_of_scope`, `not_applicable`.

Purposes and legal bases are proposals taken from the plan. TODO(fluxkit): legal review of the purposes, bases and retention periods (plan tasks O3, O5).

## Tables and columns

| Table | Columns | Class | Row | Export | Erasure | Reason |
|---|---|---|---|---|---|---|
| `admin_audit_event` | `id`, `created_at`, `action`, `target_kind`, `target_id`, `detail` | pseudonymous (Q) | D25 | excluded | keep | The shop's accountability record of an admin action; it never holds contact data, so it survives the subject's erasure. Deleted by job 12 after one year (ADR 0033 decision 9). |
| `admin_audit_event` | `admin_user_id` | staff (S) | D25 | excluded | set_null | Admin actor id; admin ids are not exported. |
| `admin_session` | `id` | none | D19 | not_applicable | not_applicable |  |
| `admin_session` | `user_id` | staff (S) | D19 | excluded | cascade | Staff data; sessions end with the user. |
| `admin_session` | `token_hash` | secret hash (H) | D19 | excluded | cascade | A hash is never exported. |
| `admin_session` | `created_at`, `last_seen_at`, `expires_at` | staff (S) | D19 | excluded | cascade | Staff data; deleted by the session cleanup. |
| `admin_user` | `id`, `email`, `role`, `is_active`, `created_at`, `updated_at`, `failed_login_count`, `locked_until`, `last_login_at`, `password_changed_at` | staff (S) | D18 | excluded | out_of_scope | Staff data: admin users are deactivated, never deleted (ADR 0009); staff requests are handled by the employer (plan D18). |
| `admin_user` | `password_hash` | secret hash (H) | D18 | excluded | out_of_scope | A hash is never exported. Staff data: admin users are deactivated, never deleted (ADR 0009); staff requests are handled by the employer (plan D18). |
| `attribute` | all 16 columns | none | D24 | not_applicable | not_applicable | |
| `attribute_option` | all 7 columns | none | D24 | not_applicable | not_applicable | |
| `brand` | all 7 columns | none | D24 | not_applicable | not_applicable | |
| `cart` | `id`, `created_at`, `updated_at`, `expires_at` | none | D5 | not_applicable | not_applicable |  |
| `cart` | `token_hash` | secret hash (H) | D5 | excluded | cascade | A hash is never exported. |
| `cart` | `customer_id` | pseudonymous (Q) | D5 | excluded | cascade | Internal id; the export is already scoped to the subject. |
| `cart_item` | `id`, `cart_id`, `created_at`, `updated_at` | none | D5 | not_applicable | not_applicable |  |
| `cart_item` | `variant_id` | pseudonymous (Q) | D5 | excluded | cascade | Internal id; the export shows the SKU and title of the line. |
| `cart_item` | `quantity`, `seen_unit_amount`, `seen_currency` | pseudonymous (Q) | D5 | included | cascade |  |
| `category` | all 9 columns | none | D24 | not_applicable | not_applicable | |
| `customer` | `id` | pseudonymous (Q) | D1 | included | delete_row |  |
| `customer` | `email`, `first_name`, `last_name`, `phone` | personal (P) | D1 | included | delete_row |  |
| `customer` | `password_hash` | secret hash (H) | D2 | excluded | delete_row | A hash is never exported. |
| `customer` | `is_active`, `email_verified_at`, `last_login_at`, `password_changed_at`, `created_at`, `updated_at` | pseudonymous (Q) | D2 | included | delete_row |  |
| `customer` | `failed_login_count`, `locked_until` | pseudonymous (Q) | D2 | excluded | delete_row | Operational login-protection state, not data the person supplied. |
| `customer_auth_token` | `id`, `purpose`, `created_at`, `expires_at`, `used_at` | none | D4 | not_applicable | not_applicable |  |
| `customer_auth_token` | `customer_id` | pseudonymous (Q) | D4 | excluded | cascade | Operational record; the account email is exported from the customer row. |
| `customer_auth_token` | `token_hash` | secret hash (H) | D4 | excluded | cascade | A hash is never exported. |
| `customer_auth_token` | `email` | personal (P) | D4 | excluded | cascade | Operational record that repeats the account email; purged by job 10. |
| `customer_session` | `id` | none | D3 | not_applicable | not_applicable |  |
| `customer_session` | `customer_id` | pseudonymous (Q) | D3 | excluded | cascade | Internal id; the export is already scoped to the subject. |
| `customer_session` | `token_hash` | secret hash (H) | D3 | excluded | cascade | A hash is never exported. |
| `customer_session` | `created_at`, `last_seen_at` | pseudonymous (Q) | D3 | included | cascade |  |
| `customer_session` | `expires_at` | pseudonymous (Q) | D3 | excluded | cascade | Derived from the created time and the configured limits. |
| `domain_event` | `id`, `type`, `created_at`, `dispatched_at`, `attempts`, `last_error_code` | none | D17 | not_applicable | not_applicable |  |
| `domain_event` | `aggregate_id`, `payload` | pseudonymous (Q) | D17 | excluded | keep | Ids only, by rule (docs/contracts/events.md); deleted by job 4 seven days after dispatch. |
| `email_message` | `id`, `template_version`, `attempts`, `next_attempt_at`, `lease_until`, `deadline_at`, `provider_code`, `last_error_code`, `resend_of`, `updated_at` | none | D16 | not_applicable | not_applicable |  |
| `email_message` | `to_address` | personal (P) | D16 | excluded | delete_row | The account email is exported once; the mail export lists template key, status and times only. |
| `email_message` | `variables` | personal (P) | D16 | excluded | delete_row | Order lines, totals and a tracking number for rendering; no rendered body is stored. |
| `email_message` | `template_key`, `locale`, `recipient_kind`, `status`, `created_at`, `sent_at` | pseudonymous (Q) | D16 | included | delete_row |  |
| `email_message` | `customer_id`, `order_id`, `dedupe_key`, `provider_message_id` | pseudonymous (Q) | D16 | excluded | delete_row | Internal id or provider reference only the shop can use. |
| `email_message` | `admin_user_id`, `created_by_admin_id` | staff (S) | D20 | excluded | set_null | Admin actor id; admin ids are not exported. |
| `health_check` | all 2 columns | none | D24 | not_applicable | not_applicable | |
| `inventory_level` | all 6 columns | none | D24 | not_applicable | not_applicable | |
| `location` | all 6 columns | none | D24 | not_applicable | not_applicable | |
| `media` | all 9 columns | none | D24 | not_applicable | not_applicable | |
| `media_upload` | `id`, `storage_key`, `content_type`, `byte_size`, `width`, `height`, `sha256`, `created_at`, `first_attached_at` | none | D23 | not_applicable | not_applicable |  |
| `media_upload` | `created_by` | staff (S) | D20 | excluded | set_null | Admin actor id; admin ids are not exported. |
| `option` | all 5 columns | none | D24 | not_applicable | not_applicable | |
| `option_value` | all 7 columns | none | D24 | not_applicable | not_applicable | |
| `order_adjustment` | `id`, `order_id` | pseudonymous (Q) | D11 | excluded | keep | Internal id; the export identifies an order by its number. |
| `order_adjustment` | `kind`, `code`, `label`, `amount`, `included_in_price`, `source`, `created_at` | pseudonymous (Q) | D11 | included | keep | Accounting record (ADR 0017): orders are anonymised, never deleted. |
| `order_item` | `id`, `order_id`, `product_id`, `variant_id` | pseudonymous (Q) | D11 | excluded | keep | Internal id; the export identifies an order by its number. |
| `order_item` | `position`, `sku`, `product_title`, `variant_title`, `option_values`, `image_url`, `unit_amount`, `compare_at_amount`, `quantity`, `line_total`, `currency`, `requires_shipping`, `created_at` | pseudonymous (Q) | D11 | included | keep | Accounting record (ADR 0017): orders are anonymised, never deleted. |
| `order_item_reservation` | all 2 columns | none | D24 | not_applicable | not_applicable | |
| `order_shipping` | `order_id`, `method_id` | pseudonymous (Q) | D11 | excluded | keep | Internal id; the export identifies an order by its number. |
| `order_shipping` | `method_code`, `kind`, `provider_code`, `provider_service`, `title`, `amount`, `currency`, `payer`, `estimated_carrier_amount`, `created_at` | pseudonymous (Q) | D11 | included | keep | Accounting record (ADR 0017): orders are anonymised, never deleted. |
| `order_shipping` | `destination` | pseudonymous (Q) | D11 | included | keep | Public pickup point data of the carrier, no contact data; a point near home is quasi-identifying but public. |
| `order_status_change` | `id`, `order_id` | pseudonymous (Q) | D11 | excluded | keep | Internal id; the export identifies an order by its number. |
| `order_status_change` | `from_status`, `to_status`, `actor_type`, `created_at` | pseudonymous (Q) | D11 | included | keep | Accounting record (ADR 0017): orders are anonymised, never deleted. |
| `order_status_change` | `actor_admin_id` | staff (S) | D20 | excluded | set_null | Admin actor id; admin ids are not exported. |
| `order_status_change` | `reason` | free text (F) | D12 | included | keep | Append-only journal (ADR 0019); admins are told not to type personal data in reasons. TODO(fluxkit): privacy plan step 3 checks which writers fill it. |
| `payment` | `check_attempts`, `next_check_at`, `needs_attention`, `attention_code` | none | D14 | not_applicable | not_applicable |  |
| `payment` | `id`, `order_id`, `provider_payment_id`, `idempotency_key` | pseudonymous (Q) | D14 | excluded | keep | Internal id or provider reference only the shop can use. |
| `payment` | `redirect_url` | pseudonymous (Q) | D14 | excluded | keep | The provider's hosted payment page address, kept only while the attempt is live; a capability link, never exported. |
| `payment` | `provider_code`, `amount`, `currency`, `status`, `provider_status`, `provider_modified_at`, `final_amount`, `refunded_amount`, `expires_at`, `order_outcome`, `failure_code`, `card_system`, `card_last4`, `created_at`, `updated_at` | pseudonymous (Q) | D14 | included | keep | Accounting and delivery record (ADR 0017): never deleted, contains no contact data. |
| `payment` | `created_by` | staff (S) | D20 | excluded | set_null | Admin actor id; admin ids are not exported. |
| `payment_event` | `id`, `payment_id`, `dedupe_key` | pseudonymous (Q) | D14 | excluded | keep | Internal id or provider reference only the shop can use. |
| `payment_event` | `source`, `provider_status`, `provider_modified_at`, `amount`, `final_amount`, `currency`, `failure_code`, `applied`, `from_status`, `to_status`, `created_at` | pseudonymous (Q) | D14 | included | keep | Accounting and delivery record (ADR 0017): never deleted, contains no contact data. |
| `payment_event` | `actor_admin_id` | staff (S) | D20 | excluded | set_null | Admin actor id; admin ids are not exported. |
| `payment_refund` | `id`, `payment_id`, `idempotency_key` | pseudonymous (Q) | D14 | excluded | keep | Internal id or provider reference only the shop can use. |
| `payment_refund` | `amount`, `currency`, `payment_amount`, `status`, `reason`, `provider_modified_at`, `failure_code`, `created_at`, `updated_at` | pseudonymous (Q) | D14 | included | keep | Accounting and delivery record (ADR 0017): never deleted, contains no contact data. |
| `payment_refund` | `note` | free text (F) | D15 | excluded | keep | Admin free text that may name staff (the amounts and statuses are exported); admins are told not to type personal data. |
| `payment_refund` | `actor_admin_id` | staff (S) | D20 | excluded | set_null | Admin actor id; admin ids are not exported. |
| `price` | all 7 columns | none | D24 | not_applicable | not_applicable | |
| `privacy_request` | `id`, `kind`, `subject_kind`, `channel`, `status`, `received_at`, `due_at`, `completed_at`, `result` | pseudonymous (Q) | D25 | included | keep | Proof that a request was answered and the data to re-apply an erasure after a backup restore; never contact data. Deleted by job 12 after the retention period (ADR 0033 decision 8). |
| `privacy_request` | `subject_customer_id` | pseudonymous (Q) | D25 | excluded | keep | Internal id of a possibly deleted customer, kept to re-apply the erasure after a backup restore. Proof that a request was answered and the data to re-apply an erasure after a backup restore; never contact data. Deleted by job 12 after the retention period (ADR 0033 decision 8). |
| `privacy_request` | `subject_email_hash` | secret hash (H) | D25 | excluded | keep | HMAC of the address, never the address; a hash is never exported. Proof that a request was answered and the data to re-apply an erasure after a backup restore; never contact data. Deleted by job 12 after the retention period (ADR 0033 decision 8). |
| `privacy_request` | `note` | free text (F) | D25 | excluded | keep | Admin free text (how the identity was checked), labelled 'no personal data' in the admin UI. Proof that a request was answered and the data to re-apply an erasure after a backup restore; never contact data. Deleted by job 12 after the retention period (ADR 0033 decision 8). |
| `privacy_request` | `handled_by` | staff (S) | D25 | excluded | set_null | Admin actor id; admin ids are not exported. |
| `product` | all 11 columns | none | D24 | not_applicable | not_applicable | |
| `product_category` | all 5 columns | none | D24 | not_applicable | not_applicable | |
| `product_option` | all 4 columns | none | D24 | not_applicable | not_applicable | |
| `product_option_value` | all 5 columns | none | D24 | not_applicable | not_applicable | |
| `product_type` | all 6 columns | none | D24 | not_applicable | not_applicable | |
| `product_type_attribute` | all 6 columns | none | D24 | not_applicable | not_applicable | |
| `product_type_option` | all 4 columns | none | D24 | not_applicable | not_applicable | |
| `reservation` | `id`, `variant_id`, `location_id`, `quantity`, `status`, `expires_at`, `created_at`, `updated_at` | none | D21 | not_applicable | not_applicable |  |
| `reservation` | `reference` | pseudonymous (Q) | D21 | excluded | keep | May hold an order number; expires with the reservation. |
| `sales_order` | `email`, `phone`, `first_name`, `last_name` | personal (P) | D6 | included | anonymise |  |
| `sales_order` | `shipping_address`, `billing_address` | personal (P) | D7 | included | anonymise |  |
| `sales_order` | `number`, `status`, `locale`, `currency`, `subtotal_amount`, `shipping_total`, `discount_total`, `tax_total`, `total_amount`, `placed_at`, `expires_at`, `paid_at`, `fulfilled_at`, `cancelled_at`, `expired_at`, `created_at`, `updated_at` | pseudonymous (Q) | D8 | included | keep | Accounting record (ADR 0017): orders are anonymised, never deleted. |
| `sales_order` | `id` | pseudonymous (Q) | D8 | excluded | keep | Internal id; the export identifies an order by its number. |
| `sales_order` | `customer_id` | pseudonymous (Q) | D8 | excluded | set_null | Detached by the customer delete (ADR 0019 foreign key). |
| `sales_order` | `access_token_hash`, `access_expires_at` | secret hash (H) | D9 | excluded | clear | A hash is never exported; the guest link stops working after anonymisation. |
| `sales_order` | `idempotency_key` | secret hash (H) | D9 | excluded | keep | A random client key with no personal content; a hash is never exported. |
| `sales_order` | `request_fingerprint` | secret hash (H) | D9 | excluded | anonymise | Unsalted hash of the checkout request: replaced by a hash of random bytes, because it could confirm a guess of the erased contact data. |
| `sales_order` | `cancellation_reason` | free text (F) | D10 | included | anonymise |  |
| `sales_order` | `contact_erased_at` | pseudonymous (Q) | D6 | included | anonymise | Set by the anonymisation itself (core ORDER_ANONYMISATION_PLAN, set_erased_at): it marks the contact as erased. |
| `sales_order` | `payment_reference` | free text (F) | D10 | included | keep | Bank or provider reference needed for accounting; the admin UI says not to type names here. |
| `search_index_state` | all 17 columns | none | D24 | not_applicable | not_applicable | |
| `search_sync_queue` | all 8 columns | none | D24 | not_applicable | not_applicable | |
| `search_synonym_group` | `id`, `locale`, `terms`, `created_at`, `updated_at` | none | D24 | not_applicable | not_applicable |  |
| `search_synonym_group` | `created_by_admin_id` | staff (S) | D24 | excluded | set_null | Admin actor id; admin ids are not exported. |
| `shipment` | `next_track_at`, `tracking_attempts` | none | D13 | not_applicable | not_applicable |  |
| `shipment` | `id`, `order_id`, `provider_ref` | pseudonymous (Q) | D13 | excluded | keep | Internal id or provider reference only the shop can use. |
| `shipment` | `provider_code`, `provider_service`, `status`, `carrier_status_code`, `carrier_status_at`, `tracking_number`, `client_reference`, `declared_value_amount`, `currency`, `carrier_cost_amount`, `payer`, `weight_grams`, `length_mm`, `width_mm`, `height_mm`, `seats`, `created_at`, `updated_at`, `cancelled_at`, `delivered_at` | pseudonymous (Q) | D13 | included | keep | Accounting and delivery record (ADR 0017): never deleted, contains no contact data. |
| `shipment` | `created_by` | staff (S) | D20 | excluded | set_null | Admin actor id; admin ids are not exported. |
| `shipment_status_change` | `id`, `shipment_id` | pseudonymous (Q) | D13 | excluded | keep | Internal id or provider reference only the shop can use. |
| `shipment_status_change` | `from_status`, `to_status`, `carrier_status_code`, `actor_type`, `created_at` | pseudonymous (Q) | D13 | included | keep | Accounting and delivery record (ADR 0017): never deleted, contains no contact data. |
| `shipment_status_change` | `actor_admin_id` | staff (S) | D20 | excluded | set_null | Admin actor id; admin ids are not exported. |
| `shipping_method` | all 14 columns | none | D24 | not_applicable | not_applicable | |
| `shipping_provider_setting` | `provider_code`, `updated_at` | none | D22 | not_applicable | not_applicable |  |
| `shipping_provider_setting` | `settings` | personal (P) | D22 | excluded | out_of_scope | Sender profile of the shop (name, phone, email, company); a sole proprietor is a natural person. The owner edits it; it is not data of a shopper. |
| `shipping_provider_setting` | `updated_by` | staff (S) | D20 | excluded | set_null | Admin actor id; admin ids are not exported. |
| `stock_movement` | `id`, `variant_id`, `location_id`, `delta`, `kind`, `on_hand_after`, `created_at` | none | D21 | not_applicable | not_applicable |  |
| `stock_movement` | `reason` | free text (F) | D21 | excluded | keep | Append-only inventory journal with admin free text; not data about a shopper. |
| `stock_movement` | `reference` | pseudonymous (Q) | D21 | excluded | keep | May hold an order number; inventory journal, append-only. |
| `stock_movement` | `actor_id` | staff (S) | D20 | excluded | set_null | Admin actor id; admin ids are not exported. |
| `variant` | all 14 columns | none | D24 | not_applicable | not_applicable | |
| `variant_option_value` | all 5 columns | none | D24 | not_applicable | not_applicable | |

## Rows: purpose and retention

| Row | Purpose (basis) | Retention |
|---|---|---|
| D1 | Account (C) | Until the account is deleted; inactive accounts are not purged |
| D2 | Account security (LI) | As D1 |
| D3 | Customer sign-in (C) | Job 6 removes a session at its absolute end (default 90 days) |
| D4 | Password reset and email verification (C) | Job 10: 30 days after expiry |
| D5 | Cart (C) | Job 5: `CART_TTL_DAYS` (default 30) |
| D6 | Order, delivery, support (C); accounting (L) | Until `ORDER_CONTACT_RETENTION_DAYS` when set (job 12), else forever; erased on request |
| D7 | Delivery (C) | As D6 |
| D8 | Accounting record (L) | Forever (accounting record) |
| D9 | Guest order access, checkout replay (C) | Forever as hashes; guest access ends after `ORDER_GUEST_ACCESS_DAYS` (default 90) |
| D10 | Order handling (C, L) | As D6 |
| D11 | Accounting record (L) | Forever, immutable |
| D12 | Order journal (C, L) | Forever, append-only |
| D13 | Delivery (C) | Forever |
| D14 | Payment and refunds (C, L) | Forever |
| D15 | Payment journal (L) | Forever |
| D16 | Mail delivery (C) | Job 10: 30 days (`failed`, `unknown`: 90) |
| D17 | Event outbox (C) | Job 4: 7 days after dispatch |
| D18 | Staff access (LI) | Forever (deactivate only) |
| D19 | Staff sign-in | Removed after expiry by the expired-session cleanup |
| D20 | Accountability (LI) | Forever; set to NULL when the admin user is deleted |
| D21 | Inventory journal | Forever, append-only |
| D22 | Sending parcels (C, LI) | Until the owner changes it |
| D23 | Catalog images | Job 7 removes abandoned uploads |
| D24 | No personal data (catalog, pricing, inventory, shipping methods, search, health) | Not applicable |
| D25 | Accountability (L, LI) | Requests 1095 days after completion, audit events 365 days; only when `ORDER_CONTACT_RETENTION_DAYS` is set (job 12) |
