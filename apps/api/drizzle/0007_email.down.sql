-- Hand-written rollback for 0007_email (drizzle-kit does not generate down migrations).
-- Tables are dropped in exact reverse creation order, without CASCADE: an unexpected dependent object must fail loudly.
-- Dropping a table also drops its constraints, foreign keys and indexes. The migration creates no function or trigger.
-- This deletes every outbox mail (pending ones are never sent) and every password reset and verification token (their
-- links stop working). Customers, orders and admin users are NOT touched: customer.email_verified_at keeps its value.
-- Also removes the bookkeeping row, otherwise the migrator would think this migration is still applied.
-- The created_at value is "when" of this entry in meta/_journal.json.
DROP TABLE IF EXISTS "email_message";
DROP TABLE IF EXISTS "customer_auth_token";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1793012311626;
