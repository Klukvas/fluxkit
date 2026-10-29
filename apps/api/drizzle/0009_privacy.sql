CREATE TABLE "admin_audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"admin_user_id" uuid,
	"action" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "admin_audit_event_action_check" CHECK ("admin_audit_event"."action" ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
	CONSTRAINT "admin_audit_event_target_kind_check" CHECK ("admin_audit_event"."target_kind" IN ('customer', 'order', 'admin_user', 'privacy_request')),
	CONSTRAINT "admin_audit_event_detail_check" CHECK (jsonb_typeof("admin_audit_event"."detail") = 'object' AND octet_length("admin_audit_event"."detail"::text) <= 2048)
);
--> statement-breakpoint
CREATE TABLE "privacy_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_customer_id" uuid,
	"subject_email_hash" text,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"result" jsonb,
	"note" text,
	"handled_by" uuid,
	CONSTRAINT "privacy_request_kind_check" CHECK ("privacy_request"."kind" IN ('export', 'erasure')),
	CONSTRAINT "privacy_request_subject_kind_check" CHECK ("privacy_request"."subject_kind" IN ('customer', 'email')),
	CONSTRAINT "privacy_request_channel_check" CHECK ("privacy_request"."channel" IN ('self_service', 'admin')),
	CONSTRAINT "privacy_request_status_check" CHECK ("privacy_request"."status" IN ('received', 'in_progress', 'completed', 'rejected')),
	CONSTRAINT "privacy_request_subject_customer_check" CHECK ("privacy_request"."subject_kind" <> 'customer' OR "privacy_request"."subject_customer_id" IS NOT NULL),
	CONSTRAINT "privacy_request_subject_email_check" CHECK ("privacy_request"."subject_kind" <> 'email' OR "privacy_request"."subject_email_hash" IS NOT NULL OR "privacy_request"."status" IN ('completed', 'rejected')),
	CONSTRAINT "privacy_request_subject_email_hash_check" CHECK ("privacy_request"."subject_email_hash" IS NULL OR "privacy_request"."subject_email_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "privacy_request_self_service_check" CHECK ("privacy_request"."channel" <> 'self_service' OR ("privacy_request"."subject_kind" = 'customer' AND "privacy_request"."handled_by" IS NULL)),
	CONSTRAINT "privacy_request_completed_at_check" CHECK (("privacy_request"."status" IN ('completed', 'rejected')) = ("privacy_request"."completed_at" IS NOT NULL)),
	CONSTRAINT "privacy_request_completed_after_received_check" CHECK ("privacy_request"."completed_at" IS NULL OR "privacy_request"."completed_at" >= "privacy_request"."received_at"),
	CONSTRAINT "privacy_request_due_at_check" CHECK ("privacy_request"."due_at" > "privacy_request"."received_at"),
	CONSTRAINT "privacy_request_result_check" CHECK ("privacy_request"."result" IS NULL OR jsonb_typeof("privacy_request"."result") = 'object'),
	CONSTRAINT "privacy_request_note_check" CHECK ("privacy_request"."note" IS NULL OR char_length("privacy_request"."note") BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "sales_order" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_order" ALTER COLUMN "phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_order" ALTER COLUMN "first_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_order" ALTER COLUMN "last_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_order" ADD COLUMN "contact_erased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_audit_event" ADD CONSTRAINT "admin_audit_event_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_request" ADD CONSTRAINT "privacy_request_handled_by_fkey" FOREIGN KEY ("handled_by") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_event_created_at_idx" ON "admin_audit_event" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "admin_audit_event_admin_user_id_created_at_idx" ON "admin_audit_event" USING btree ("admin_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "admin_audit_event_target_idx" ON "admin_audit_event" USING btree ("target_kind","target_id");--> statement-breakpoint
CREATE INDEX "privacy_request_status_due_at_idx" ON "privacy_request" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "privacy_request_subject_email_hash_idx" ON "privacy_request" USING btree ("subject_email_hash");--> statement-breakpoint
CREATE INDEX "privacy_request_subject_customer_id_idx" ON "privacy_request" USING btree ("subject_customer_id");--> statement-breakpoint
CREATE INDEX "privacy_request_completed_at_idx" ON "privacy_request" USING btree ("completed_at");--> statement-breakpoint
CREATE INDEX "privacy_request_handled_by_idx" ON "privacy_request" USING btree ("handled_by");--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_contact_check" CHECK (("sales_order"."contact_erased_at" IS NULL AND "sales_order"."email" IS NOT NULL AND "sales_order"."phone" IS NOT NULL AND "sales_order"."first_name" IS NOT NULL AND "sales_order"."last_name" IS NOT NULL) OR ("sales_order"."contact_erased_at" IS NOT NULL AND "sales_order"."email" IS NULL AND "sales_order"."phone" IS NULL AND "sales_order"."first_name" IS NULL AND "sales_order"."last_name" IS NULL));--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_erased_access_check" CHECK ("sales_order"."contact_erased_at" IS NULL OR "sales_order"."access_token_hash" IS NULL);;--> statement-breakpoint
-- Hand-written (drizzle-kit does not model triggers). admin_audit_event is append-only (ADR 0033 decision 9, the ADR 0019
-- technique): no UPDATE, except the SET NULL of admin_user_id done by the foreign key when an admin user is deleted
-- (pg_trigger_depth() is 1 for a statement of a client and above 1 inside a referential action), and no DELETE of a row
-- younger than AUDIT_EVENT_RETENTION_DAYS (365, packages/core): only job 12's purge of older rows may delete.
CREATE FUNCTION "admin_audit_event_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF OLD.created_at < clock_timestamp() - interval '365 days' THEN
			RETURN OLD;
		END IF;
	ELSIF pg_trigger_depth() > 1 AND OLD.admin_user_id IS NOT NULL AND NEW.admin_user_id IS NULL
		AND to_jsonb(NEW) - 'admin_user_id' = to_jsonb(OLD) - 'admin_user_id' THEN
		RETURN NEW;
	END IF;
	RAISE EXCEPTION 'admin_audit_event is append-only: % is not allowed', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "admin_audit_event_append_only" BEFORE UPDATE OR DELETE ON "admin_audit_event" FOR EACH ROW EXECUTE FUNCTION "admin_audit_event_append_only"();
