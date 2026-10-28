CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider_code" text NOT NULL,
	"provider_payment_id" text,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"provider_status" text,
	"provider_modified_at" timestamp with time zone,
	"final_amount" bigint,
	"refunded_amount" bigint DEFAULT 0 NOT NULL,
	"redirect_url" text,
	"expires_at" timestamp with time zone NOT NULL,
	"order_outcome" text,
	"needs_attention" boolean DEFAULT false NOT NULL,
	"attention_code" text,
	"failure_code" text,
	"card_system" text,
	"card_last4" text,
	"next_check_at" timestamp with time zone,
	"check_attempts" integer DEFAULT 0 NOT NULL,
	"idempotency_key" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_provider_code_provider_payment_id_key" UNIQUE("provider_code","provider_payment_id"),
	CONSTRAINT "payment_order_id_idempotency_key_key" UNIQUE("order_id","idempotency_key"),
	CONSTRAINT "payment_id_currency_amount_key" UNIQUE("id","currency","amount"),
	CONSTRAINT "payment_provider_code_check" CHECK ("payment"."provider_code" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "payment_provider_payment_id_check" CHECK ("payment"."provider_payment_id" IS NULL OR "payment"."provider_payment_id" ~ '^[A-Za-z0-9_.-]{1,64}$'),
	CONSTRAINT "payment_amount_check" CHECK ("payment"."amount" > 0 AND "payment"."amount" <= 1000000000000),
	CONSTRAINT "payment_currency_check" CHECK ("payment"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payment_status_check" CHECK ("payment"."status" IN ('creating', 'awaiting_customer', 'processing', 'succeeded', 'failed', 'expired', 'invalidated', 'create_unknown')),
	CONSTRAINT "payment_provider_status_check" CHECK ("payment"."provider_status" IS NULL OR "payment"."provider_status" ~ '^[A-Za-z0-9_.-]{1,32}$'),
	CONSTRAINT "payment_provider_fact_check" CHECK (("payment"."provider_status" IS NULL) = ("payment"."provider_modified_at" IS NULL)),
	CONSTRAINT "payment_provider_payment_id_status_check" CHECK ("payment"."status" NOT IN ('processing', 'succeeded', 'expired', 'invalidated') OR "payment"."provider_payment_id" IS NOT NULL),
	CONSTRAINT "payment_final_amount_check" CHECK ("payment"."final_amount" IS NULL OR ("payment"."final_amount" >= 0 AND "payment"."final_amount" <= "payment"."amount")),
	CONSTRAINT "payment_refunded_amount_check" CHECK ("payment"."refunded_amount" >= 0 AND "payment"."refunded_amount" <= "payment"."amount" AND ("payment"."refunded_amount" = 0 OR "payment"."status" = 'succeeded')),
	CONSTRAINT "payment_redirect_url_check" CHECK ("payment"."redirect_url" IS NULL OR (char_length("payment"."redirect_url") <= 2048 AND "payment"."redirect_url" ~ '^https://[!-~]+$')),
	CONSTRAINT "payment_redirect_url_status_check" CHECK ("payment"."redirect_url" IS NULL OR "payment"."status" IN ('creating', 'awaiting_customer', 'processing', 'create_unknown')),
	CONSTRAINT "payment_awaiting_customer_check" CHECK ("payment"."status" <> 'awaiting_customer' OR ("payment"."provider_payment_id" IS NOT NULL AND "payment"."redirect_url" IS NOT NULL)),
	CONSTRAINT "payment_order_outcome_check" CHECK ("payment"."order_outcome" IS NULL OR "payment"."order_outcome" IN ('applied', 'already_paid', 'order_not_payable', 'amount_mismatch', 'reference_conflict')),
	CONSTRAINT "payment_order_outcome_status_check" CHECK ("payment"."order_outcome" IS NULL OR "payment"."status" = 'succeeded'),
	CONSTRAINT "payment_attention_code_check" CHECK ("payment"."attention_code" IS NULL OR "payment"."attention_code" IN ('late_payment', 'duplicate_payment', 'amount_mismatch', 'fact_not_bound', 'unknown_provider_status', 'unexpected_provider_status', 'external_reversal', 'refund_failed', 'refund_mismatch', 'reconcile_gave_up')),
	CONSTRAINT "payment_needs_attention_check" CHECK (NOT "payment"."needs_attention" OR "payment"."attention_code" IS NOT NULL),
	CONSTRAINT "payment_failure_code_check" CHECK ("payment"."failure_code" IS NULL OR "payment"."failure_code" ~ '^[A-Za-z0-9_.:-]{1,64}$'),
	CONSTRAINT "payment_card_system_check" CHECK ("payment"."card_system" IS NULL OR "payment"."card_system" ~ '^[A-Za-z][A-Za-z0-9_.-]{0,31}$'),
	CONSTRAINT "payment_card_last4_check" CHECK ("payment"."card_last4" IS NULL OR "payment"."card_last4" ~ '^[0-9]{4}$'),
	CONSTRAINT "payment_card_check" CHECK (("payment"."card_system" IS NULL) = ("payment"."card_last4" IS NULL)),
	CONSTRAINT "payment_next_check_at_check" CHECK ("payment"."status" NOT IN ('creating', 'awaiting_customer', 'processing', 'create_unknown') OR "payment"."next_check_at" IS NOT NULL),
	CONSTRAINT "payment_check_attempts_check" CHECK ("payment"."check_attempts" >= 0),
	CONSTRAINT "payment_expires_at_check" CHECK ("payment"."expires_at" > "payment"."created_at"),
	CONSTRAINT "payment_created_by_check" CHECK ("payment"."created_by" IN ('customer', 'guest', 'admin')),
	CONSTRAINT "payment_idempotency_key_check" CHECK ("payment"."created_by" = 'admin' OR "payment"."idempotency_key" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "payment_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"source" text NOT NULL,
	"dedupe_key" text,
	"provider_status" text,
	"provider_modified_at" timestamp with time zone,
	"amount" bigint,
	"final_amount" bigint,
	"currency" text,
	"failure_code" text,
	"applied" boolean NOT NULL,
	"from_status" text,
	"to_status" text,
	"actor_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "payment_event_dedupe_key_key" UNIQUE("dedupe_key"),
	CONSTRAINT "payment_event_source_check" CHECK ("payment_event"."source" IN ('webhook', 'poll', 'create', 'admin', 'system')),
	CONSTRAINT "payment_event_dedupe_key_check" CHECK ("payment_event"."dedupe_key" IS NULL OR (char_length("payment_event"."dedupe_key") <= 200 AND "payment_event"."dedupe_key" ~ '^[a-z]+:[A-Za-z0-9_.:-]+$' AND split_part("payment_event"."dedupe_key", ':', 1) = "payment_event"."source")),
	CONSTRAINT "payment_event_webhook_dedupe_key_check" CHECK ("payment_event"."source" <> 'webhook' OR ("payment_event"."dedupe_key" IS NOT NULL AND "payment_event"."dedupe_key" ~ '^webhook:[0-9a-f]{64}$')),
	CONSTRAINT "payment_event_poll_dedupe_key_check" CHECK ("payment_event"."source" <> 'poll' OR ("payment_event"."dedupe_key" IS NOT NULL AND "payment_event"."dedupe_key" ~ '^poll:[A-Za-z0-9_.-]{1,32}:[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z:(null|0|[1-9][0-9]{0,12}):[0-9a-f]{64}$')),
	CONSTRAINT "payment_event_provider_status_check" CHECK ("payment_event"."provider_status" IS NULL OR "payment_event"."provider_status" ~ '^[A-Za-z0-9_.-]{1,32}$'),
	CONSTRAINT "payment_event_provider_fact_check" CHECK (("payment_event"."provider_status" IS NULL) = ("payment_event"."provider_modified_at" IS NULL)),
	CONSTRAINT "payment_event_fact_check" CHECK ("payment_event"."source" NOT IN ('webhook', 'poll') OR ("payment_event"."provider_status" IS NOT NULL AND "payment_event"."provider_modified_at" IS NOT NULL AND "payment_event"."amount" IS NOT NULL)),
	CONSTRAINT "payment_event_money_check" CHECK (("payment_event"."amount" IS NULL) = ("payment_event"."currency" IS NULL) AND ("payment_event"."final_amount" IS NULL OR "payment_event"."amount" IS NOT NULL)),
	CONSTRAINT "payment_event_amount_check" CHECK ("payment_event"."amount" IS NULL OR ("payment_event"."amount" > 0 AND "payment_event"."amount" <= 1000000000000)),
	CONSTRAINT "payment_event_final_amount_check" CHECK ("payment_event"."final_amount" IS NULL OR ("payment_event"."final_amount" >= 0 AND "payment_event"."final_amount" <= 1000000000000)),
	CONSTRAINT "payment_event_currency_check" CHECK ("payment_event"."currency" IS NULL OR "payment_event"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payment_event_failure_code_check" CHECK ("payment_event"."failure_code" IS NULL OR "payment_event"."failure_code" ~ '^[A-Za-z0-9_.:-]{1,64}$'),
	CONSTRAINT "payment_event_from_status_check" CHECK ("payment_event"."from_status" IS NULL OR "payment_event"."from_status" IN ('creating', 'awaiting_customer', 'processing', 'succeeded', 'failed', 'expired', 'invalidated', 'create_unknown')),
	CONSTRAINT "payment_event_to_status_check" CHECK ("payment_event"."to_status" IS NULL OR "payment_event"."to_status" IN ('creating', 'awaiting_customer', 'processing', 'succeeded', 'failed', 'expired', 'invalidated', 'create_unknown')),
	CONSTRAINT "payment_event_status_change_check" CHECK (("payment_event"."to_status" IS NULL OR "payment_event"."applied") AND ("payment_event"."from_status" IS NULL OR ("payment_event"."to_status" IS NOT NULL AND "payment_event"."from_status" <> "payment_event"."to_status"))),
	CONSTRAINT "payment_event_actor_check" CHECK ("payment_event"."actor_admin_id" IS NULL OR "payment_event"."source" = 'admin')
);
--> statement-breakpoint
CREATE TABLE "payment_refund" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"payment_amount" bigint NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"actor_admin_id" uuid,
	"idempotency_key" uuid,
	"provider_modified_at" timestamp with time zone,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_refund_idempotency_key_key" UNIQUE("idempotency_key"),
	CONSTRAINT "payment_refund_amount_check" CHECK ("payment_refund"."amount" > 0 AND "payment_refund"."amount" <= "payment_refund"."payment_amount" AND "payment_refund"."payment_amount" <= 1000000000000),
	CONSTRAINT "payment_refund_currency_check" CHECK ("payment_refund"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payment_refund_status_check" CHECK ("payment_refund"."status" IN ('requested', 'processing', 'succeeded', 'failed', 'unknown')),
	CONSTRAINT "payment_refund_reason_check" CHECK ("payment_refund"."reason" IN ('admin', 'late_payment', 'duplicate_payment', 'amount_mismatch')),
	CONSTRAINT "payment_refund_note_check" CHECK ("payment_refund"."note" IS NULL OR char_length("payment_refund"."note") BETWEEN 1 AND 500),
	CONSTRAINT "payment_refund_automatic_check" CHECK ("payment_refund"."reason" NOT IN ('late_payment', 'duplicate_payment') OR ("payment_refund"."actor_admin_id" IS NULL AND "payment_refund"."note" IS NULL AND "payment_refund"."idempotency_key" IS NULL)),
	CONSTRAINT "payment_refund_failure_code_check" CHECK ("payment_refund"."failure_code" IS NULL OR "payment_refund"."failure_code" ~ '^[A-Za-z0-9_.:-]{1,64}$'),
	CONSTRAINT "payment_refund_failure_code_status_check" CHECK ("payment_refund"."failure_code" IS NULL OR "payment_refund"."status" = 'failed')
);
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."sales_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_event" ADD CONSTRAINT "payment_event_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_event" ADD CONSTRAINT "payment_event_actor_admin_id_fkey" FOREIGN KEY ("actor_admin_id") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refund" ADD CONSTRAINT "payment_refund_payment_fkey" FOREIGN KEY ("payment_id","currency","payment_amount") REFERENCES "public"."payment"("id","currency","amount") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refund" ADD CONSTRAINT "payment_refund_actor_admin_id_fkey" FOREIGN KEY ("actor_admin_id") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_order_id_live_key" ON "payment" USING btree ("order_id") WHERE "payment"."status" IN ('creating', 'awaiting_customer', 'processing', 'create_unknown');--> statement-breakpoint
CREATE INDEX "payment_next_check_at_idx" ON "payment" USING btree ("next_check_at") WHERE "payment"."next_check_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "payment_event_payment_id_created_at_idx" ON "payment_event" USING btree ("payment_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_event_actor_admin_id_idx" ON "payment_event" USING btree ("actor_admin_id");--> statement-breakpoint
CREATE INDEX "payment_refund_payment_id_idx" ON "payment_refund" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_refund_actor_admin_id_idx" ON "payment_refund" USING btree ("actor_admin_id");--> statement-breakpoint
-- Hand-written part (drizzle-kit models no triggers). See docs/adr/0032-online-payments.md decision 5 (open question 9)
-- and, for the technique, docs/adr/0019-orders-schema.md. pg_trigger_depth() is 1 for a statement run by a client and
-- greater than 1 inside a referential action, so every exception below is exactly one foreign key action of the table.
-- Everything else is rejected with SQLSTATE 23001 (restrict_violation).

-- payment_event is the append-only journal of a payment attempt. Allowed at depth above 1 only: DELETE (the cascade from
-- payment, which itself is RESTRICT from sales_order and from payment_refund) and the SET NULL of actor_admin_id when the
-- admin user is deleted, with every other column identical (the same exception as order_status_change.actor_admin_id).
CREATE FUNCTION "payment_event_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF pg_trigger_depth() > 1 THEN
		IF TG_OP = 'DELETE' THEN
			RETURN OLD;
		END IF;
		IF OLD.actor_admin_id IS NOT NULL AND NEW.actor_admin_id IS NULL
			AND to_jsonb(NEW) - 'actor_admin_id' = to_jsonb(OLD) - 'actor_admin_id' THEN
			RETURN NEW;
		END IF;
	END IF;
	RAISE EXCEPTION 'payment_event is append-only: % is not allowed', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "payment_event_append_only" BEFORE UPDATE OR DELETE ON "payment_event" FOR EACH ROW EXECUTE FUNCTION "payment_event_append_only"();
