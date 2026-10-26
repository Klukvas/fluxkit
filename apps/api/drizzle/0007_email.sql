CREATE TABLE "customer_auth_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "customer_auth_token_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "customer_auth_token_purpose_check" CHECK ("customer_auth_token"."purpose" IN ('password_reset', 'email_verification')),
	CONSTRAINT "customer_auth_token_token_hash_check" CHECK ("customer_auth_token"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "customer_auth_token_email_check" CHECK ("customer_auth_token"."email" = lower(btrim("customer_auth_token"."email")) AND char_length("customer_auth_token"."email") BETWEEN 3 AND 254),
	CONSTRAINT "customer_auth_token_expires_at_check" CHECK ("customer_auth_token"."expires_at" > "customer_auth_token"."created_at" AND ("customer_auth_token"."purpose" <> 'password_reset' OR "customer_auth_token"."expires_at" <= "customer_auth_token"."created_at" + interval '60 minutes') AND ("customer_auth_token"."purpose" <> 'email_verification' OR "customer_auth_token"."expires_at" <= "customer_auth_token"."created_at" + interval '2880 minutes'))
);
--> statement-breakpoint
CREATE TABLE "email_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_key" text NOT NULL,
	"template_version" integer NOT NULL,
	"locale" text NOT NULL,
	"to_address" text NOT NULL,
	"recipient_kind" text NOT NULL,
	"customer_id" uuid,
	"order_id" uuid,
	"admin_user_id" uuid,
	"variables" jsonb NOT NULL,
	"dedupe_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"deadline_at" timestamp with time zone NOT NULL,
	"provider_code" text,
	"provider_message_id" text,
	"last_error_code" text,
	"resend_of" uuid,
	"created_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_message_dedupe_key_key" UNIQUE("dedupe_key"),
	CONSTRAINT "email_message_template_key_check" CHECK ("email_message"."template_key" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' AND char_length("email_message"."template_key") <= 64),
	CONSTRAINT "email_message_template_version_check" CHECK ("email_message"."template_version" >= 1),
	CONSTRAINT "email_message_locale_check" CHECK ("email_message"."locale" ~ '^[a-z]{2,8}(-[a-z]{2,8})*$'),
	CONSTRAINT "email_message_to_address_check" CHECK (char_length("email_message"."to_address") <= 254 AND "email_message"."to_address" ~ '^[a-z0-9!#$%&''*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&''*+/=?^_`{|}~-]+)*@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' AND char_length(split_part("email_message"."to_address", '@', 1)) <= 64 AND "email_message"."to_address" !~ '\.[0-9]+$'),
	CONSTRAINT "email_message_recipient_kind_check" CHECK ("email_message"."recipient_kind" IN ('customer', 'guest', 'admin')),
	CONSTRAINT "email_message_recipient_check" CHECK (("email_message"."recipient_kind" <> 'guest' OR "email_message"."customer_id" IS NULL) AND ("email_message"."recipient_kind" <> 'admin' OR ("email_message"."customer_id" IS NULL AND "email_message"."order_id" IS NULL)) AND ("email_message"."recipient_kind" = 'admin' OR "email_message"."admin_user_id" IS NULL)),
	CONSTRAINT "email_message_variables_check" CHECK (jsonb_typeof("email_message"."variables") = 'object' AND pg_column_size("email_message"."variables") <= 16384),
	CONSTRAINT "email_message_dedupe_key_check" CHECK ("email_message"."dedupe_key" IS NULL OR ("email_message"."dedupe_key" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:' AND substr("email_message"."dedupe_key", 38) = "email_message"."template_key")),
	CONSTRAINT "email_message_status_check" CHECK ("email_message"."status" IN ('pending', 'sending', 'sent', 'failed', 'unknown', 'cancelled')),
	CONSTRAINT "email_message_attempts_check" CHECK ("email_message"."attempts" >= 0 AND ("email_message"."status" NOT IN ('sending', 'sent', 'unknown') OR "email_message"."attempts" >= 1)),
	CONSTRAINT "email_message_lease_check" CHECK ("email_message"."status" <> 'sending' OR "email_message"."lease_until" IS NOT NULL),
	CONSTRAINT "email_message_sent_check" CHECK (("email_message"."status" = 'sent') = ("email_message"."sent_at" IS NOT NULL) AND ("email_message"."status" = 'sent') = ("email_message"."provider_message_id" IS NOT NULL) AND ("email_message"."status" <> 'sent' OR "email_message"."provider_code" IS NOT NULL)),
	CONSTRAINT "email_message_last_error_check" CHECK ("email_message"."status" NOT IN ('failed', 'unknown') OR "email_message"."last_error_code" IS NOT NULL),
	CONSTRAINT "email_message_deadline_check" CHECK ("email_message"."deadline_at" > "email_message"."created_at" AND "email_message"."deadline_at" <= "email_message"."created_at" + interval '12 hours'),
	CONSTRAINT "email_message_provider_code_check" CHECK ("email_message"."provider_code" IS NULL OR "email_message"."provider_code" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "email_message_provider_message_id_check" CHECK ("email_message"."provider_message_id" IS NULL OR "email_message"."provider_message_id" ~ '^[A-Za-z0-9_.:-]{1,64}$'),
	CONSTRAINT "email_message_last_error_code_check" CHECK ("email_message"."last_error_code" IS NULL OR "email_message"."last_error_code" ~ '^[A-Za-z0-9_.:-]{1,64}$'),
	CONSTRAINT "email_message_resend_of_check" CHECK ("email_message"."resend_of" IS NULL OR "email_message"."resend_of" <> "email_message"."id")
);
--> statement-breakpoint
ALTER TABLE "customer_auth_token" ADD CONSTRAINT "customer_auth_token_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."sales_order"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_resend_of_fkey" FOREIGN KEY ("resend_of") REFERENCES "public"."email_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_auth_token_customer_id_purpose_created_at_idx" ON "customer_auth_token" USING btree ("customer_id","purpose","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_auth_token_customer_id_purpose_unused_key" ON "customer_auth_token" USING btree ("customer_id","purpose") WHERE "customer_auth_token"."used_at" IS NULL;--> statement-breakpoint
CREATE INDEX "email_message_next_attempt_at_idx" ON "email_message" USING btree ("next_attempt_at") WHERE "email_message"."status" IN ('pending', 'sending');--> statement-breakpoint
CREATE INDEX "email_message_status_updated_at_idx" ON "email_message" USING btree ("status","updated_at") WHERE "email_message"."status" IN ('sent', 'failed', 'unknown', 'cancelled');--> statement-breakpoint
CREATE INDEX "email_message_created_at_idx" ON "email_message" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "email_message_to_address_idx" ON "email_message" USING btree ("to_address");--> statement-breakpoint
CREATE INDEX "email_message_customer_id_idx" ON "email_message" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "email_message_order_id_idx" ON "email_message" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "email_message_admin_user_id_idx" ON "email_message" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "email_message_resend_of_idx" ON "email_message" USING btree ("resend_of");--> statement-breakpoint
CREATE INDEX "email_message_created_by_admin_id_idx" ON "email_message" USING btree ("created_by_admin_id");