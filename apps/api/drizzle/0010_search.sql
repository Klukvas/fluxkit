CREATE SEQUENCE "public"."search_sync_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "search_index_state" (
	"locale" text PRIMARY KEY NOT NULL,
	"live_index_uid" text,
	"build_index_uid" text,
	"settings_hash" text,
	"document_version" integer,
	"currency" text,
	"rebuild_requested_at" timestamp with time zone,
	"build_started_at" timestamp with time zone,
	"build_cursor" uuid,
	"build_documents_count" integer DEFAULT 0 NOT NULL,
	"built_at" timestamp with time zone,
	"documents_count" integer,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"last_error_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_index_state_locale_check" CHECK ("search_index_state"."locale" ~ '^[a-z]{2,8}(-[a-z]{2,8})*$'),
	CONSTRAINT "search_index_state_live_index_uid_check" CHECK ("search_index_state"."live_index_uid" IS NULL OR "search_index_state"."live_index_uid" ~ '^[a-z0-9_]{1,128}$'),
	CONSTRAINT "search_index_state_build_index_uid_check" CHECK ("search_index_state"."build_index_uid" IS NULL OR "search_index_state"."build_index_uid" ~ '^[a-z0-9_]{1,128}$'),
	CONSTRAINT "search_index_state_build_check" CHECK (("search_index_state"."build_index_uid" IS NULL) = ("search_index_state"."build_started_at" IS NULL)),
	CONSTRAINT "search_index_state_build_uid_distinct_check" CHECK ("search_index_state"."build_index_uid" IS NULL OR "search_index_state"."live_index_uid" IS NULL OR "search_index_state"."build_index_uid" <> "search_index_state"."live_index_uid"),
	CONSTRAINT "search_index_state_cursor_check" CHECK ("search_index_state"."build_cursor" IS NULL OR "search_index_state"."build_index_uid" IS NOT NULL),
	CONSTRAINT "search_index_state_settings_hash_check" CHECK ("search_index_state"."settings_hash" IS NULL OR "search_index_state"."settings_hash" ~ '^[0-9a-f]{14}$'),
	CONSTRAINT "search_index_state_currency_check" CHECK ("search_index_state"."currency" IS NULL OR "search_index_state"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "search_index_state_live_check" CHECK ("search_index_state"."live_index_uid" IS NULL OR ("search_index_state"."document_version" IS NOT NULL AND "search_index_state"."currency" IS NOT NULL AND "search_index_state"."settings_hash" IS NOT NULL AND "search_index_state"."built_at" IS NOT NULL AND "search_index_state"."documents_count" IS NOT NULL)),
	CONSTRAINT "search_index_state_document_version_check" CHECK ("search_index_state"."document_version" IS NULL OR "search_index_state"."document_version" >= 1),
	CONSTRAINT "search_index_state_counts_check" CHECK ("search_index_state"."build_documents_count" >= 0 AND ("search_index_state"."documents_count" IS NULL OR "search_index_state"."documents_count" >= 0) AND "search_index_state"."failed_attempts" >= 0),
	CONSTRAINT "search_index_state_last_error_code_check" CHECK ("search_index_state"."last_error_code" IS NULL OR "search_index_state"."last_error_code" ~ '^[a-z][a-z0-9_]{0,63}$')
);
--> statement-breakpoint
CREATE TABLE "search_sync_queue" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"change_seq" bigint DEFAULT nextval('search_sync_seq') NOT NULL,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	CONSTRAINT "search_sync_queue_reason_check" CHECK ("search_sync_queue"."reason" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "search_sync_queue_last_error_code_check" CHECK ("search_sync_queue"."last_error_code" IS NULL OR "search_sync_queue"."last_error_code" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "search_sync_queue_attempts_check" CHECK ("search_sync_queue"."attempts" >= 0),
	CONSTRAINT "search_sync_queue_change_seq_check" CHECK ("search_sync_queue"."change_seq" > 0)
);
--> statement-breakpoint
CREATE TABLE "search_synonym_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"locale" text NOT NULL,
	"terms" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_admin_id" uuid,
	CONSTRAINT "search_synonym_group_locale_check" CHECK ("search_synonym_group"."locale" ~ '^[a-z]{2,8}(-[a-z]{2,8})*$'),
	CONSTRAINT "search_synonym_group_terms_check" CHECK (cardinality("search_synonym_group"."terms") BETWEEN 2 AND 20 AND array_position("search_synonym_group"."terms", NULL) IS NULL AND array_position("search_synonym_group"."terms", '') IS NULL AND array_to_string("search_synonym_group"."terms", '') !~ '[[:cntrl:]]' AND NOT (array_to_string("search_synonym_group"."terms", chr(31)) ~ '[^\x1f]{51}')),
	CONSTRAINT "search_synonym_group_updated_at_check" CHECK ("search_synonym_group"."updated_at" >= "search_synonym_group"."created_at")
);
--> statement-breakpoint
ALTER TABLE "search_synonym_group" ADD CONSTRAINT "search_synonym_group_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_sync_queue_next_attempt_at_idx" ON "search_sync_queue" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE INDEX "search_synonym_group_locale_idx" ON "search_synonym_group" USING btree ("locale","created_at");--> statement-breakpoint
CREATE INDEX "search_synonym_group_created_by_admin_id_idx" ON "search_synonym_group" USING btree ("created_by_admin_id");