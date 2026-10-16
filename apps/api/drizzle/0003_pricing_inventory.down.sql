-- Hand-written rollback for 0003_pricing_inventory (drizzle-kit does not generate down migrations).
-- Tables are dropped in exact reverse dependency order, without CASCADE: an unexpected dependent object must fail loudly.
-- Dropping stock_movement also drops its trigger. This deletes all prices, stock levels, reservations and the journal.
-- Also removes the bookkeeping row, otherwise the migrator would think this migration is still applied.
-- The created_at value is "when" of this entry in meta/_journal.json.
DROP TABLE IF EXISTS "reservation";
DROP TABLE IF EXISTS "stock_movement";
DROP FUNCTION IF EXISTS "stock_movement_append_only"();
DROP TABLE IF EXISTS "inventory_level";
DROP TABLE IF EXISTS "price";
DROP TABLE IF EXISTS "location";
ALTER TABLE "variant" DROP COLUMN IF EXISTS "allow_backorder";
ALTER TABLE "variant" DROP COLUMN IF EXISTS "track_inventory";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1792145613200;
