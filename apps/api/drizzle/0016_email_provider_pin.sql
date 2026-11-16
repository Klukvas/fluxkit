ALTER TABLE "email_message" DROP CONSTRAINT "email_message_provider_message_id_check";--> statement-breakpoint
ALTER TABLE "email_message" ADD COLUMN "pinned_provider_code" text;--> statement-breakpoint
ALTER TABLE "email_message" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_pinned_provider_code_check" CHECK ("email_message"."pinned_provider_code" IS NULL OR "email_message"."pinned_provider_code" ~ '^[a-z][a-z0-9_]{0,63}$');--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_pin_check" CHECK (("email_message"."pinned_provider_code" IS NULL) = ("email_message"."pinned_at" IS NULL));--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_provider_message_id_check" CHECK ("email_message"."provider_message_id" IS NULL OR (char_length("email_message"."provider_message_id") BETWEEN 1 AND 255 AND ("email_message"."provider_message_id" ~ '^[A-Za-z0-9_.:-]{1,64}$' OR "email_message"."provider_message_id" ~ '^<[A-Za-z0-9_.:+-]+@[A-Za-z0-9.-]+>$')));
--> statement-breakpoint
-- All old senders must be stopped before this migration. Unknown history is conservatively pinned.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "email_message" WHERE "status" IN ('pending', 'sending')
    AND "attempts" > 0 AND "provider_code" IS NULL) THEN
    RAISE EXCEPTION 'email_pin_backfill_provider_missing';
  END IF;
END $$;
--> statement-breakpoint
UPDATE "email_message" SET "pinned_provider_code" = "provider_code", "pinned_at" = "updated_at"
WHERE "status" IN ('pending', 'sending') AND "attempts" > 0 AND "provider_code" IS NOT NULL;
