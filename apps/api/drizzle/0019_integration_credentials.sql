SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '30s';--> statement-breakpoint
CREATE TABLE "integration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"provider_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "integration_kind_check" CHECK ("integration"."kind" IN ('email', 'payment', 'shipping')),
	CONSTRAINT "integration_provider_code_check" CHECK ("integration"."provider_code" ~ '^[a-z][a-z0-9_]{0,63}$')
);
--> statement-breakpoint
CREATE TABLE "integration_credential_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"integration_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"purpose" text NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"retired_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "integration_credential_version_generation_check" CHECK ("integration_credential_version"."generation" >= 1),
	CONSTRAINT "integration_credential_version_purpose_check" CHECK ("integration_credential_version"."purpose" IN ('outbound', 'webhook')),
	CONSTRAINT "integration_credential_version_state_check" CHECK ("integration_credential_version"."state" IN ('candidate', 'active', 'draining', 'revoked', 'retired')),
	CONSTRAINT "integration_credential_version_retired_at_check" CHECK (("integration_credential_version"."state" = 'retired') = ("integration_credential_version"."retired_at" IS NOT NULL)),
	CONSTRAINT "integration_credential_version_revoked_at_check" CHECK (("integration_credential_version"."state" = 'revoked') = ("integration_credential_version"."revoked_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "integration_revision" (
	"id" smallint PRIMARY KEY NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_revision_singleton_check" CHECK ("integration_revision"."id" = 1),
	CONSTRAINT "integration_revision_revision_check" CHECK ("integration_revision"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "integration_secret" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version_id" uuid NOT NULL,
	"field" text NOT NULL,
	"key_id" text NOT NULL,
	"nonce" "bytea" NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"tag" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_secret_field_check" CHECK ("integration_secret"."field" ~ '^[a-z][a-z0-9_]{0,31}$'),
	CONSTRAINT "integration_secret_key_id_check" CHECK ("integration_secret"."key_id" ~ '^[A-Za-z0-9_-]{1,32}$'),
	CONSTRAINT "integration_secret_nonce_check" CHECK (octet_length("integration_secret"."nonce") = 12),
	CONSTRAINT "integration_secret_tag_check" CHECK (octet_length("integration_secret"."tag") = 16),
	CONSTRAINT "integration_secret_ciphertext_check" CHECK (octet_length("integration_secret"."ciphertext") BETWEEN 1 AND 4096)
);
--> statement-breakpoint
ALTER TABLE "admin_audit_event" DROP CONSTRAINT "admin_audit_event_target_kind_check";--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credential_version" ADD CONSTRAINT "integration_credential_version_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credential_version" ADD CONSTRAINT "integration_credential_version_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_secret" ADD CONSTRAINT "integration_secret_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "public"."integration_credential_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_kind_provider_code_key" ON "integration" USING btree ("kind","provider_code");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_credential_version_generation_key" ON "integration_credential_version" USING btree ("integration_id","generation");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_credential_version_candidate_key" ON "integration_credential_version" USING btree ("integration_id","purpose") WHERE "integration_credential_version"."state" = 'candidate';--> statement-breakpoint
CREATE UNIQUE INDEX "integration_credential_version_active_key" ON "integration_credential_version" USING btree ("integration_id","purpose") WHERE "integration_credential_version"."state" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "integration_secret_version_id_field_key" ON "integration_secret" USING btree ("version_id","field");--> statement-breakpoint
CREATE INDEX "integration_secret_key_id_idx" ON "integration_secret" USING btree ("key_id","id");--> statement-breakpoint
ALTER TABLE "admin_audit_event" ADD CONSTRAINT "admin_audit_event_target_kind_check" CHECK ("admin_audit_event"."target_kind" IN ('customer', 'order', 'admin_user', 'privacy_request', 'email_suppression', 'integration'));--> statement-breakpoint
-- Hand-written: the single revision row every integration change increments (ADR 0058).
INSERT INTO "integration_revision" ("id", "revision") VALUES (1, 0);
