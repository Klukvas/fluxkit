-- Hand-written rollback for 0016_email_provider_pin (drizzle-kit does not generate down migrations).
-- Refuse incompatible references and active pins rather than allowing duplicate sends or losing evidence.
-- The created_at value is "when" of this entry in meta/_journal.json.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "email_message" WHERE "provider_message_id" IS NOT NULL
    AND "provider_message_id" !~ '^[A-Za-z0-9_.:-]{1,64}$') THEN
    RAISE EXCEPTION 'provider_message_id_rollback_incompatible';
  END IF;
  IF EXISTS (SELECT 1 FROM "email_message" WHERE "status" IN ('pending', 'sending')
    AND "pinned_provider_code" IS NOT NULL) THEN
    RAISE EXCEPTION 'email_pin_rollback_incompatible';
  END IF;
END $$;
ALTER TABLE "email_message" DROP CONSTRAINT "email_message_provider_message_id_check";
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_provider_message_id_check" CHECK ("email_message"."provider_message_id" IS NULL OR "email_message"."provider_message_id" ~ '^[A-Za-z0-9_.:-]{1,64}$');
ALTER TABLE "email_message" DROP CONSTRAINT "email_message_pin_check";
ALTER TABLE "email_message" DROP CONSTRAINT "email_message_pinned_provider_code_check";
ALTER TABLE "email_message" DROP COLUMN "pinned_at";
ALTER TABLE "email_message" DROP COLUMN "pinned_provider_code";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1794788880753;
COMMIT;
