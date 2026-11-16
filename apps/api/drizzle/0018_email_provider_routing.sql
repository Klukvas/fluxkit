-- Bounded quiescent rollout; review a concurrent-index rollout separately for a large outbox.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '30s';--> statement-breakpoint
CREATE TABLE "email_provider_state" (
	"provider_code" text PRIMARY KEY NOT NULL,
	"unavailable_until" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"probe_token" uuid,
	"probe_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_provider_state_provider_code_check" CHECK ("email_provider_state"."provider_code" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "email_provider_state_reason_check" CHECK ("email_provider_state"."reason" IN ('quota_exceeded', 'rate_limited', 'misconfigured')),
	CONSTRAINT "email_provider_state_probe_check" CHECK (("email_provider_state"."probe_token" IS NULL) = ("email_provider_state"."probe_until" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "email_message" ADD COLUMN "route_provider_code" text;--> statement-breakpoint
CREATE INDEX "email_message_provider_sent_at_idx" ON "email_message" USING btree ("provider_code","sent_at") WHERE "email_message"."status" = 'sent';--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_route_provider_code_check" CHECK ("email_message"."route_provider_code" IS NULL OR "email_message"."route_provider_code" ~ '^[a-z][a-z0-9_]{0,63}$');