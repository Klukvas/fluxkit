# 0004. Core data model

Status: accepted (decisions); entity list is a design draft to be refined when writing the schema

## Decisions
1. **Attributes**: values stored in JSONB on Product (product-level) and Variant (variant-level), validated on the backend against the
   ProductType's attribute definitions (type, unit, required, allowed options).
2. **Prices**: separate `price` table (`variant_id`, `currency`, `amount` in minor units, optional rules: customer group, min quantity, validity dates).
   No on-the-fly currency conversion for catalog prices.
3. **Inventory**: `inventory_level` per `variant_id` + `location_id` with `on_hand` and `reserved`, reservations with expiry during checkout,
   and an append-only `stock_movement` journal. Row locking prevents overselling.
4. **Cart and orders**: mutable `cart` -> immutable `order` with item snapshot. `payment` and `fulfillment` (shipment) are separate entities
   with their own state machines; order status is derived from them (supports partial payment/shipping, returns, cash on delivery).

## Draft entities
- Catalog: `product_type`, `attribute` (definition), `attribute_option` (dictionary values), `product_type_attribute` (assignment, level product|variant),
  `category`, `brand`, `product`, `product_option`, `product_option_value`, `variant`, `variant_option_value`, `media`.
- Pricing: `price`, `price_rule`/customer group (later), `tax_class`, `currency`.
- Inventory: `location`, `inventory_level`, `reservation`, `stock_movement`.
- Sales: `cart`, `cart_item`, `order`, `order_item` (snapshot), `payment`, `payment_attempt`, `fulfillment`, `fulfillment_item`, `refund`/`return`.
- Customers: `customer`, `address`, `customer_group`.
- Platform: `store_settings`, `feature_flag` state, `event_outbox`, `audit_log`.

## Design notes (proposed by the architect role, confirm when implementing)
- Store attribute option **codes** (stable), not labels, in JSONB; labels live in `attribute_option` with i18n. Renaming a label never touches products.
  Deleting an option in use is blocked or requires an explicit migration step.
- Flags on `attribute`: `is_filterable`, `is_searchable`, `is_visible_on_storefront`, `is_comparable`, `is_sortable`, `is_internal`
  (see earlier attribute rules). Category filter overrides in `category_filter`.
- Money: integer minor units + currency everywhere; rounding rules in one module with TDD.
- Order items snapshot: title, SKU, option values, unit price, tax, image, attributes needed for invoices.
- Outbox pattern for events (order created, stock changed, product updated) so Meilisearch indexing and webhooks are reliable.
- Every state transition (order, payment, fulfillment) goes through an explicit state machine with tests; no direct status writes.

## Consequences
- JSONB attributes: fast reads and simple schema, but data migrations are needed when attribute definitions change type or options are removed.
- Price table and inventory levels add joins but make multi-currency, B2B pricing and multi-warehouse additive, not rewrites.
- More entities than a minimal shop: justified by the Ukraine -> EU/US roadmap and cash-on-delivery support.

## Open questions
- Taxes: prices tax-inclusive or exclusive per market (UA vs EU/US)? Needs its own decision.
- Discounts/coupons: core or feature module? (currently feature; core must expose a price-adjustment extension point).
- Customer groups and B2B pricing: when to introduce.
