-- Hand-written rollback for 0015_inventory_reserved_upper_bound (drizzle-kit does not generate down migrations).
-- Restore the non-negative check without changing inventory data, and remove exactly this migration's bookkeeping row.
-- The created_at value is "when" of this entry in meta/_journal.json.
BEGIN;
ALTER TABLE "inventory_level" DROP CONSTRAINT "inventory_level_reserved_check";
ALTER TABLE "inventory_level" ADD CONSTRAINT "inventory_level_reserved_check" CHECK ("inventory_level"."reserved" >= 0);
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1794703483735;
COMMIT;
