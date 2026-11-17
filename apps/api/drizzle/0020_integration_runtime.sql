ALTER TABLE "email_message" ADD COLUMN "integration_credential_version_id" uuid;--> statement-breakpoint
ALTER TABLE "integration" ADD COLUMN "enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "integration" ADD COLUMN "active_outbound_version_id" uuid;--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_integration_credential_version_id_fkey" FOREIGN KEY ("integration_credential_version_id") REFERENCES "public"."integration_credential_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_message_integration_credential_version_id_idx" ON "email_message" USING btree ("integration_credential_version_id");--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_enabled_pointer_check" CHECK ("integration"."enabled" = false OR "integration"."active_outbound_version_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_active_outbound_version_id_fkey" FOREIGN KEY ("active_outbound_version_id") REFERENCES "public"."integration_credential_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- The pointer may name only an outbound version of this same integration (ADR 0058).
CREATE OR REPLACE FUNCTION "integration_outbound_version_same_row"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."active_outbound_version_id" IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "integration_credential_version"
    WHERE "id" = NEW."active_outbound_version_id"
      AND "integration_id" = NEW."id"
      AND "purpose" = 'outbound'
  ) THEN
    RAISE EXCEPTION 'integration_outbound_version_mismatch';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "integration_outbound_version_same_row" BEFORE INSERT OR UPDATE OF "active_outbound_version_id" ON "integration" FOR EACH ROW EXECUTE FUNCTION "integration_outbound_version_same_row"();