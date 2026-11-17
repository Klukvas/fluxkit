-- Stop the API before rollback. Never discard a stored credential, a version tombstone or the audit evidence of one:
-- retire the credentials in the admin (or restore them to the server environment) and keep the audit log first.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
-- 0020 adds a foreign key from email_message and a trigger on integration. Drop those first when they exist,
-- and forget 0020's journal row, so this rollback can run on a database that has already applied 0020.
ALTER TABLE IF EXISTS "email_message" DROP CONSTRAINT IF EXISTS "email_message_integration_credential_version_id_fkey";
ALTER TABLE IF EXISTS "email_message" DROP COLUMN IF EXISTS "integration_credential_version_id";
DROP TRIGGER IF EXISTS "integration_outbound_version_same_row" ON "integration";
DROP FUNCTION IF EXISTS "integration_outbound_version_same_row"();
ALTER TABLE IF EXISTS "integration" DROP CONSTRAINT IF EXISTS "integration_active_outbound_version_id_fkey";
ALTER TABLE IF EXISTS "integration" DROP CONSTRAINT IF EXISTS "integration_enabled_pointer_check";
ALTER TABLE IF EXISTS "integration" DROP COLUMN IF EXISTS "active_outbound_version_id";
ALTER TABLE IF EXISTS "integration" DROP COLUMN IF EXISTS "enabled";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1794912832085;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "integration_credential_version")
    OR EXISTS (SELECT 1 FROM "integration_secret")
    OR EXISTS (SELECT 1 FROM "admin_audit_event"
      WHERE "target_kind" = 'integration' OR "action" = 'admin_user.step_up_failed') THEN
    RAISE EXCEPTION 'integration_credentials_rollback_incompatible';
  END IF;
END $$;
ALTER TABLE "admin_audit_event" DROP CONSTRAINT "admin_audit_event_target_kind_check";
ALTER TABLE "admin_audit_event" ADD CONSTRAINT "admin_audit_event_target_kind_check" CHECK ("admin_audit_event"."target_kind" IN ('customer', 'order', 'admin_user', 'privacy_request', 'email_suppression'));
DROP TABLE "integration_secret";
DROP TABLE "integration_credential_version";
DROP TABLE "integration";
DROP TABLE "integration_revision";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1794859651850;
COMMIT;
