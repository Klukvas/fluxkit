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
- Pricing: `price` (with optional `customer_group_id`), `tax_class`, `tax_rate`/region rules, `currency`.
- Inventory: `location`, `inventory_level`, `reservation`, `stock_movement`.
- Sales: `cart`, `cart_item`, `order`, `order_item` (snapshot), `payment`, `payment_attempt`, `fulfillment`, `fulfillment_item`, `refund`/`return`.
- Customers: `customer`, `address`, `customer_group` (core from day one).
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

## Resolved open questions
- **Taxes**: price stored as entered; a `prices_include_tax` setting (per store/currency) defines its meaning; rates live in `tax_class` and region
  rules. UA (incl./excl. VAT), EU (VAT-inclusive) and US (tax-exclusive, tax at checkout) fit one model. Full US sales tax by address uses an external provider plugin.
- **Discounts/coupons**: the core owns an ordered pricing pipeline (lines -> discounts -> taxes -> shipping -> total) with registered
  price adjusters in fixed steps. Coupons/promotions/loyalty are feature modules that register adjusters; disabling them leaves the pipeline intact. Fully TDD.
- **Customer groups / B2B**: `customer_group` and `price.customer_group_id` exist in the core from day one. B2B logic (wholesale prices,
  invoices, company accounts) is a paid feature module added later without schema migration.

## Still open
- Exact pipeline steps and adjuster contract (to be published in `docs/contracts/`).
- Rounding rules per currency and tax-rounding strategy (per line vs per order).
- Returns/refund model details.
