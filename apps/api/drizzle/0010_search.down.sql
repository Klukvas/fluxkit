-- Hand-written rollback for 0010_search (drizzle-kit does not generate down migrations).
-- Drops the search queue, the index state and the synonym groups (ADR 0034). No catalog table is touched: the index is
-- derived data, so nothing is lost that a rebuild cannot recreate except the admin's synonym groups.
-- The engine's indexes are NOT deleted by this script; an operator removes them with the master key if wanted.
-- Tables are dropped without CASCADE: an unexpected dependent object must fail loudly. The sequence is dropped after the
-- table whose default uses it.
-- Also removes the bookkeeping row, otherwise the migrator would think this migration is still applied.
-- The created_at value is "when" of this entry in meta/_journal.json.
DROP TABLE IF EXISTS "search_synonym_group";
DROP TABLE IF EXISTS "search_sync_queue";
DROP TABLE IF EXISTS "search_index_state";
DROP SEQUENCE IF EXISTS "search_sync_seq";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1793271071859;
