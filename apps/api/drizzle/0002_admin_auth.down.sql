-- Hand-written rollback for 0002_admin_auth (drizzle-kit does not generate down migrations).
-- Tables are dropped in exact reverse dependency order, without CASCADE: an unexpected dependent object must fail loudly.
-- Also removes the bookkeeping row, otherwise the migrator would think this migration is still applied.
-- The created_at value is "when" of this entry in meta/_journal.json.
DROP TABLE IF EXISTS "admin_session";
DROP TABLE IF EXISTS "admin_user";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1792078437735;
