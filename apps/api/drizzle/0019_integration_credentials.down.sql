-- Stop the API before rollback. Never discard a stored credential, a version tombstone or the audit evidence of one:
-- retire the credentials in the admin (or restore them to the server environment) and keep the audit log first.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
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
