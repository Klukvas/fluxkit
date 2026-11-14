-- Hand-written rollback for 0000_blog_post of the blog feature (drizzle-kit does not generate down migrations). Run it by hand
-- before deleting the feature (packages/features/blog/README.md, "Removing the feature"), and before any core down: this table
-- references media_upload (ADR 0049). Every post is lost; cover uploads stay attached with their files.
-- Dropping the table drops its indexes, checks and the hand-added foreign key. Also removes the bookkeeping row of the
-- feature's own migrations table; the created_at value is "when" of this entry in meta/_journal.json.
DROP TABLE IF EXISTS "blog_post";
DELETE FROM "drizzle"."__drizzle_migrations_feature_blog" WHERE "created_at" = 1794601366256;
