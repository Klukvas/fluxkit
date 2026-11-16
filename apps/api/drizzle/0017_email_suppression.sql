CREATE TABLE "email_suppression" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to_address" text NOT NULL,
	"reason" text NOT NULL,
	"source_provider" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "email_suppression_to_address_key" UNIQUE("to_address"),
	CONSTRAINT "email_suppression_to_address_check" CHECK (char_length("email_suppression"."to_address") <= 254 AND "email_suppression"."to_address" ~ '^[a-z0-9!#$%&''*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&''*+/=?^_`{|}~-]+)*@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' AND char_length(split_part("email_suppression"."to_address", '@', 1)) <= 64 AND "email_suppression"."to_address" !~ '\.[0-9]+$'),
	CONSTRAINT "email_suppression_reason_check" CHECK ("email_suppression"."reason" IN ('hard_bounce', 'complaint', 'unsubscribe', 'blocked')),
	CONSTRAINT "email_suppression_source_provider_check" CHECK ("email_suppression"."source_provider" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "email_suppression_seen_check" CHECK ("email_suppression"."first_seen_at" <= "email_suppression"."last_seen_at")
);
--> statement-breakpoint
CREATE TABLE "email_webhook_receipt" (
	"provider_code" text NOT NULL,
	"event_key" text NOT NULL,
	"to_address" text NOT NULL,
	"event_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	CONSTRAINT "email_webhook_receipt_pkey" PRIMARY KEY("provider_code","event_key"),
	CONSTRAINT "email_webhook_receipt_provider_code_check" CHECK ("email_webhook_receipt"."provider_code" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "email_webhook_receipt_event_key_check" CHECK ("email_webhook_receipt"."event_key" ~ '^[A-Za-z0-9_.:-]{1,255}$'),
	CONSTRAINT "email_webhook_receipt_to_address_check" CHECK (char_length("email_webhook_receipt"."to_address") <= 254 AND "email_webhook_receipt"."to_address" ~ '^[a-z0-9!#$%&''*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&''*+/=?^_`{|}~-]+)*@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' AND char_length(split_part("email_webhook_receipt"."to_address", '@', 1)) <= 64 AND "email_webhook_receipt"."to_address" !~ '\.[0-9]+$')
);
--> statement-breakpoint
ALTER TABLE "admin_audit_event" DROP CONSTRAINT "admin_audit_event_target_kind_check";--> statement-breakpoint
CREATE INDEX "email_suppression_last_seen_at_idx" ON "email_suppression" USING btree ("last_seen_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "email_webhook_receipt_received_at_idx" ON "email_webhook_receipt" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "email_webhook_receipt_to_address_idx" ON "email_webhook_receipt" USING btree ("to_address");--> statement-breakpoint
ALTER TABLE "admin_audit_event" ADD CONSTRAINT "admin_audit_event_target_kind_check" CHECK ("admin_audit_event"."target_kind" IN ('customer', 'order', 'admin_user', 'privacy_request', 'email_suppression'));