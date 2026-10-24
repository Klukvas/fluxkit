-- Hand-written rollback for 0006_shipping (drizzle-kit does not generate down migrations).
-- Tables are dropped in exact reverse dependency order, without CASCADE: an unexpected dependent object must fail loudly.
-- Dropping a table also drops its trigger; the two trigger functions are dropped afterwards.
-- This deletes every shipping method, provider setting, order shipping snapshot, shipment and shipment journal row.
-- Orders and their order_adjustment rows of migration 0004 are NOT touched: a shipping adjustment, sales_order.shipping_total
-- and the readable sales_order.shipping_address of a pickup-point order stay as they were written.
-- Also removes the bookkeeping row, otherwise the migrator would think this migration is still applied.
-- The created_at value is "when" of this entry in meta/_journal.json.
DROP TABLE IF EXISTS "shipment_status_change";
DROP TABLE IF EXISTS "shipment";
DROP TABLE IF EXISTS "order_shipping";
DROP TABLE IF EXISTS "shipping_provider_setting";
DROP TABLE IF EXISTS "shipping_method";
DROP FUNCTION IF EXISTS "shipment_status_change_append_only"();
DROP FUNCTION IF EXISTS "order_shipping_immutable"();
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1792863777442;
