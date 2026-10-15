CREATE TABLE "admin_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "admin_session_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "admin_session_token_hash_check" CHECK ("admin_session"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "admin_session_expires_at_check" CHECK ("admin_session"."expires_at" > "admin_session"."created_at")
);
--> statement-breakpoint
CREATE TABLE "admin_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_user_email_key" UNIQUE("email"),
	CONSTRAINT "admin_user_email_check" CHECK ("admin_user"."email" = lower("admin_user"."email") AND char_length("admin_user"."email") BETWEEN 3 AND 254),
	CONSTRAINT "admin_user_password_hash_check" CHECK ("admin_user"."password_hash" <> ''),
	CONSTRAINT "admin_user_role_check" CHECK ("admin_user"."role" IN ('owner', 'manager', 'viewer')),
	CONSTRAINT "admin_user_failed_login_count_check" CHECK ("admin_user"."failed_login_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "admin_session" ADD CONSTRAINT "admin_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_session_user_id_idx" ON "admin_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "admin_session_expires_at_idx" ON "admin_session" USING btree ("expires_at");