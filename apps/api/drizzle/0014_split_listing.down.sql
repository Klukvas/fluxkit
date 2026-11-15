-- Hand-written rollback for 0014_split_listing; saved listing choices and build keys are lost.
-- The created_at value is the exact "when" of this migration in meta/_journal.json.
DROP INDEX IF EXISTS "product_type_one_split_option_idx";
ALTER TABLE "product_type_option" DROP COLUMN IF EXISTS "splits_listing";
ALTER TABLE "search_index_state" DROP COLUMN IF EXISTS "build_rebuild_key";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1794699341331;
