CREATE TABLE "email_route_setting" (
	"id" smallint PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'equal' NOT NULL,
	"turn" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "email_route_setting_singleton_check" CHECK ("email_route_setting"."id" = 1),
	CONSTRAINT "email_route_setting_mode_check" CHECK ("email_route_setting"."mode" IN ('equal', 'resend')),
	CONSTRAINT "email_route_setting_turn_check" CHECK ("email_route_setting"."turn" >= 0)
);
--> statement-breakpoint
INSERT INTO "email_route_setting" ("id", "mode", "turn") VALUES (1, 'equal', 0);
--> statement-breakpoint
ALTER TABLE "email_message" ADD COLUMN "assigned_provider_code" text;--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_assigned_provider_code_check" CHECK ("email_message"."assigned_provider_code" IS NULL OR "email_message"."assigned_provider_code" IN ('resend', 'brevo'));
