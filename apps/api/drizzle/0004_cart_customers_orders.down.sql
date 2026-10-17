-- Hand-written rollback for 0004_cart_customers_orders (drizzle-kit does not generate down migrations).
-- Tables are dropped in exact reverse dependency order, without CASCADE: an unexpected dependent object must fail loudly.
-- Dropping a table also drops its trigger; the three trigger functions are dropped afterwards.
-- This deletes all customers, sessions, carts, orders (with their snapshots and journals) and domain events.
-- Reservations and stock rows of migration 0003 are NOT touched: order_item_reservation only points at them.
-- Also removes the bookkeeping row, otherwise the migrator would think this migration is still applied.
-- The created_at value is "when" of this entry in meta/_journal.json.
DROP TABLE IF EXISTS "order_item_reservation";
DROP TABLE IF EXISTS "order_status_change";
DROP TABLE IF EXISTS "order_adjustment";
DROP TABLE IF EXISTS "order_item";
DROP TABLE IF EXISTS "sales_order";
DROP TABLE IF EXISTS "cart_item";
DROP TABLE IF EXISTS "cart";
DROP TABLE IF EXISTS "customer_session";
DROP TABLE IF EXISTS "customer";
DROP TABLE IF EXISTS "domain_event";
DROP FUNCTION IF EXISTS "order_status_change_append_only"();
DROP FUNCTION IF EXISTS "order_adjustment_append_only"();
DROP FUNCTION IF EXISTS "order_item_immutable"();
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1792222060348;
