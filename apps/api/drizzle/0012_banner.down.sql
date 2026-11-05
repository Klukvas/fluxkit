-- Hand-written rollback for 0012_banner (drizzle-kit does not generate down migrations).
-- Drops the home banners (ADR 0046): banner_image first (it references banner), then banner. The banner rows are lost;
-- the uploads they used stay in media_upload, attached, with their files (attached uploads are never deleted).
-- Tables are dropped without CASCADE: an unexpected dependent object must fail loudly.
-- Also removes the bookkeeping row, otherwise the migrator would think this migration is still applied.
-- The created_at value is "when" of this entry in meta/_journal.json.
DROP TABLE IF EXISTS "banner_image";
DROP TABLE IF EXISTS "banner";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1793904934919;
