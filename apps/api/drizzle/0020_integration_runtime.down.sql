-- Stop writers first. Refuses while a stored credential is in use or a mail is bound to one.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "integration" WHERE "enabled" OR "active_outbound_version_id" IS NOT NULL)
    OR EXISTS (SELECT 1 FROM "email_message" WHERE "integration_credential_version_id" IS NOT NULL)
    OR EXISTS (
      SELECT 1 FROM "integration_credential_version"
      WHERE "state" IN ('active', 'draining', 'revoked')
    ) THEN
    RAISE EXCEPTION 'integration_runtime_rollback_incompatible';
  END IF;
END $$;
DROP TRIGGER IF EXISTS "integration_outbound_version_same_row" ON "integration";
DROP FUNCTION IF EXISTS "integration_outbound_version_same_row"();
ALTER TABLE "email_message" DROP CONSTRAINT "email_message_integration_credential_version_id_fkey";
ALTER TABLE "integration" DROP CONSTRAINT "integration_active_outbound_version_id_fkey";
ALTER TABLE "integration" DROP CONSTRAINT "integration_enabled_pointer_check";
ALTER TABLE "email_message" DROP COLUMN "integration_credential_version_id";
ALTER TABLE "integration" DROP COLUMN "active_outbound_version_id";
ALTER TABLE "integration" DROP COLUMN "enabled";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1794912832085;
COMMIT;
