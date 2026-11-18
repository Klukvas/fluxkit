-- The mode and the per-message assignment are operational. Dropping them returns every new mail to the sender's own order.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE IF EXISTS "email_message" DROP CONSTRAINT IF EXISTS "email_message_assigned_provider_code_check";
ALTER TABLE IF EXISTS "email_message" DROP COLUMN IF EXISTS "assigned_provider_code";
DROP TABLE IF EXISTS "email_route_setting";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1794948540931;
COMMIT;
