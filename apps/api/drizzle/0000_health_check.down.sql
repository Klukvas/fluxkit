-- Hand-written rollback for 0000_health_check (drizzle-kit does not generate down migrations).
-- Also removes the bookkeeping row, otherwise the migrator would think this migration is still applied.
-- The created_at value is "when" of this entry in meta/_journal.json.
DROP TABLE IF EXISTS "health_check";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1792018251363;
