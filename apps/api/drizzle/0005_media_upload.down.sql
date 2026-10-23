-- Hand-written rollback for 0005_media_upload (drizzle-kit does not generate down migrations).
-- Dropping the table also drops its constraints, its foreign key to admin_user and its partial index. No CASCADE: an
-- unexpected dependent object must fail loudly.
-- This deletes the upload records only. The stored files in MEDIA_DIR are NOT touched, and product media and brand logos
-- keep their URLs (they never had a foreign key to this table); after a rollback nothing checks those URLs any more.
-- Also removes the bookkeeping row, otherwise the migrator would think this migration is still applied.
-- The created_at value is "when" of this entry in meta/_journal.json.
DROP TABLE IF EXISTS "media_upload";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1792776632660;
