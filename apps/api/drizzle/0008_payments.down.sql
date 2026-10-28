-- Hand-written rollback for 0008_payments (drizzle-kit does not generate down migrations).
-- Tables are dropped in exact reverse dependency order, without CASCADE: an unexpected dependent object must fail loudly.
-- Dropping a table also drops its constraints, indexes and trigger; the trigger function is dropped afterwards.
-- This deletes every payment attempt, payment journal row and refund. Orders are NOT touched: sales_order.status,
-- payment_reference and paid_at keep what markPaid wrote.
-- Also removes the bookkeeping row, otherwise the migrator would think this migration is still applied.
-- The created_at value is "when" of this entry in meta/_journal.json.
DROP TABLE IF EXISTS "payment_refund";
DROP TABLE IF EXISTS "payment_event";
DROP TABLE IF EXISTS "payment";
DROP FUNCTION IF EXISTS "payment_event_append_only"();
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1793057500182;
