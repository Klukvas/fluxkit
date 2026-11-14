-- Hand-written rollback for 0000_fixture_note of the notebook test fixture feature (drizzle-kit does not generate down
-- migrations). A feature down runs before any core down (ADR 0049): this table references media_upload.
-- Dropping the table drops its foreign key. Also removes the bookkeeping row of the feature's own migrations table;
-- the created_at value is "when" of this entry in meta/_journal.json.
DROP TABLE IF EXISTS "fixture_note";
DELETE FROM "drizzle"."__drizzle_migrations_feature_notebook" WHERE "created_at" = 1794597251160;
