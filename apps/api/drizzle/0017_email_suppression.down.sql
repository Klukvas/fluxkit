-- Hand-written rollback for 0017_email_suppression. Stop senders and webhook ingress first.
-- Never discard active safety state or replay protection; audit history must remain interpretable.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "email_suppression")
    OR EXISTS (SELECT 1 FROM "email_webhook_receipt")
    OR EXISTS (SELECT 1 FROM "admin_audit_event" WHERE "target_kind" = 'email_suppression') THEN
    RAISE EXCEPTION 'email_suppression_rollback_incompatible';
  END IF;
END $$;
ALTER TABLE "admin_audit_event" DROP CONSTRAINT "admin_audit_event_target_kind_check";
ALTER TABLE "admin_audit_event" ADD CONSTRAINT "admin_audit_event_target_kind_check" CHECK ("admin_audit_event"."target_kind" IN ('customer', 'order', 'admin_user', 'privacy_request'));
DROP TABLE "email_webhook_receipt";
DROP TABLE "email_suppression";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1794827031304;
COMMIT;
