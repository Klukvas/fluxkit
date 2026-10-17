CREATE TABLE "customer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"email_verified_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_email_key" UNIQUE("email"),
	CONSTRAINT "customer_email_check" CHECK ("customer"."email" = lower(btrim("customer"."email")) AND char_length("customer"."email") BETWEEN 3 AND 254),
	CONSTRAINT "customer_password_hash_check" CHECK ("customer"."password_hash" <> ''),
	CONSTRAINT "customer_first_name_check" CHECK (char_length("customer"."first_name") BETWEEN 1 AND 100),
	CONSTRAINT "customer_last_name_check" CHECK (char_length("customer"."last_name") BETWEEN 1 AND 100),
	CONSTRAINT "customer_phone_check" CHECK ("customer"."phone" IS NULL OR "customer"."phone" ~ '^\+?[0-9]{7,15}$'),
	CONSTRAINT "customer_failed_login_count_check" CHECK ("customer"."failed_login_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "customer_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "customer_session_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "customer_session_token_hash_check" CHECK ("customer_session"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "customer_session_expires_at_check" CHECK ("customer_session"."expires_at" > "customer_session"."created_at")
);
--> statement-breakpoint
CREATE TABLE "cart" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text,
	"customer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "cart_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "cart_customer_id_key" UNIQUE("customer_id"),
	CONSTRAINT "cart_token_hash_check" CHECK ("cart"."token_hash" IS NULL OR "cart"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "cart_owner_check" CHECK (("cart"."token_hash" IS NULL) <> ("cart"."customer_id" IS NULL)),
	CONSTRAINT "cart_expires_at_check" CHECK ("cart"."expires_at" > "cart"."created_at")
);
--> statement-breakpoint
CREATE TABLE "cart_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cart_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"seen_unit_amount" bigint,
	"seen_currency" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_item_cart_id_variant_id_key" UNIQUE("cart_id","variant_id"),
	CONSTRAINT "cart_item_quantity_check" CHECK ("cart_item"."quantity" >= 1 AND "cart_item"."quantity" <= 999),
	CONSTRAINT "cart_item_seen_unit_amount_check" CHECK ("cart_item"."seen_unit_amount" IS NULL OR ("cart_item"."seen_unit_amount" >= 0 AND "cart_item"."seen_unit_amount" <= 1000000000000)),
	CONSTRAINT "cart_item_seen_currency_check" CHECK ("cart_item"."seen_currency" IS NULL OR "cart_item"."seen_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "cart_item_seen_price_check" CHECK (("cart_item"."seen_unit_amount" IS NULL) = ("cart_item"."seen_currency" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "order_adjustment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"label" jsonb NOT NULL,
	"amount" bigint NOT NULL,
	"included_in_price" boolean NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_adjustment_kind_check" CHECK ("order_adjustment"."kind" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "order_adjustment_code_check" CHECK (char_length("order_adjustment"."code") BETWEEN 1 AND 64),
	CONSTRAINT "order_adjustment_label_check" CHECK (jsonb_typeof("order_adjustment"."label") = 'object'),
	CONSTRAINT "order_adjustment_amount_check" CHECK ("order_adjustment"."amount" >= -1000000000000 AND "order_adjustment"."amount" <= 1000000000000),
	CONSTRAINT "order_adjustment_source_check" CHECK ("order_adjustment"."source" IS NULL OR char_length("order_adjustment"."source") BETWEEN 1 AND 64)
);
--> statement-breakpoint
CREATE TABLE "order_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"product_id" uuid,
	"variant_id" uuid,
	"sku" text NOT NULL,
	"product_title" jsonb NOT NULL,
	"variant_title" jsonb,
	"option_values" jsonb NOT NULL,
	"image_url" text,
	"unit_amount" bigint NOT NULL,
	"compare_at_amount" bigint,
	"quantity" integer NOT NULL,
	"line_total" bigint NOT NULL,
	"currency" text NOT NULL,
	"requires_shipping" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_item_order_id_position_key" UNIQUE("order_id","position"),
	CONSTRAINT "order_item_position_check" CHECK ("order_item"."position" >= 0),
	CONSTRAINT "order_item_sku_check" CHECK (char_length("order_item"."sku") BETWEEN 1 AND 64),
	CONSTRAINT "order_item_product_title_check" CHECK (jsonb_typeof("order_item"."product_title") = 'object'),
	CONSTRAINT "order_item_variant_title_check" CHECK ("order_item"."variant_title" IS NULL OR jsonb_typeof("order_item"."variant_title") = 'object'),
	CONSTRAINT "order_item_option_values_check" CHECK (jsonb_typeof("order_item"."option_values") = 'array'),
	CONSTRAINT "order_item_image_url_check" CHECK ("order_item"."image_url" IS NULL OR char_length("order_item"."image_url") BETWEEN 1 AND 2048),
	CONSTRAINT "order_item_unit_amount_check" CHECK ("order_item"."unit_amount" >= 0 AND "order_item"."unit_amount" <= 1000000000000),
	CONSTRAINT "order_item_compare_at_amount_check" CHECK ("order_item"."compare_at_amount" IS NULL OR ("order_item"."compare_at_amount" > "order_item"."unit_amount" AND "order_item"."compare_at_amount" <= 1000000000000)),
	CONSTRAINT "order_item_quantity_check" CHECK ("order_item"."quantity" >= 1 AND "order_item"."quantity" <= 999),
	CONSTRAINT "order_item_line_total_check" CHECK ("order_item"."line_total" >= 0 AND "order_item"."line_total" <= 1000000000000),
	CONSTRAINT "order_item_line_total_sum_check" CHECK ("order_item"."line_total" = "order_item"."unit_amount" * "order_item"."quantity"),
	CONSTRAINT "order_item_currency_check" CHECK ("order_item"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "order_item_reservation" (
	"order_item_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	CONSTRAINT "order_item_reservation_pkey" PRIMARY KEY("order_item_id","reservation_id"),
	CONSTRAINT "order_item_reservation_reservation_id_key" UNIQUE("reservation_id")
);
--> statement-breakpoint
CREATE TABLE "order_status_change" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_admin_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "order_status_change_from_status_check" CHECK ("order_status_change"."from_status" IS NULL OR "order_status_change"."from_status" IN ('awaiting_payment', 'paid', 'fulfilled', 'cancelled', 'expired')),
	CONSTRAINT "order_status_change_to_status_check" CHECK ("order_status_change"."to_status" IN ('awaiting_payment', 'paid', 'fulfilled', 'cancelled', 'expired')),
	CONSTRAINT "order_status_change_actor_type_check" CHECK ("order_status_change"."actor_type" IN ('customer', 'guest', 'admin', 'system')),
	CONSTRAINT "order_status_change_reason_check" CHECK ("order_status_change"."reason" IS NULL OR char_length("order_status_change"."reason") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE TABLE "sales_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"status" text NOT NULL,
	"customer_id" uuid,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"shipping_address" jsonb,
	"billing_address" jsonb,
	"locale" text NOT NULL,
	"currency" text NOT NULL,
	"subtotal_amount" bigint NOT NULL,
	"shipping_total" bigint NOT NULL,
	"discount_total" bigint NOT NULL,
	"tax_total" bigint NOT NULL,
	"total_amount" bigint NOT NULL,
	"access_token_hash" text,
	"access_expires_at" timestamp with time zone,
	"idempotency_key" uuid NOT NULL,
	"request_fingerprint" text NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"fulfilled_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"cancellation_reason" text,
	"payment_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_order_number_key" UNIQUE("number"),
	CONSTRAINT "sales_order_access_token_hash_key" UNIQUE("access_token_hash"),
	CONSTRAINT "sales_order_idempotency_key_key" UNIQUE("idempotency_key"),
	CONSTRAINT "sales_order_number_check" CHECK ("sales_order"."number" ~ '^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'),
	CONSTRAINT "sales_order_status_check" CHECK ("sales_order"."status" IN ('awaiting_payment', 'paid', 'fulfilled', 'cancelled', 'expired')),
	CONSTRAINT "sales_order_email_check" CHECK ("sales_order"."email" = lower(btrim("sales_order"."email")) AND char_length("sales_order"."email") BETWEEN 3 AND 254),
	CONSTRAINT "sales_order_phone_check" CHECK ("sales_order"."phone" ~ '^\+?[0-9]{7,15}$'),
	CONSTRAINT "sales_order_first_name_check" CHECK (char_length("sales_order"."first_name") BETWEEN 1 AND 100),
	CONSTRAINT "sales_order_last_name_check" CHECK (char_length("sales_order"."last_name") BETWEEN 1 AND 100),
	CONSTRAINT "sales_order_shipping_address_check" CHECK ("sales_order"."shipping_address" IS NULL OR jsonb_typeof("sales_order"."shipping_address") = 'object'),
	CONSTRAINT "sales_order_billing_address_check" CHECK ("sales_order"."billing_address" IS NULL OR jsonb_typeof("sales_order"."billing_address") = 'object'),
	CONSTRAINT "sales_order_locale_check" CHECK ("sales_order"."locale" ~ '^[a-z]{2,8}(-[a-z]{2,8})*$'),
	CONSTRAINT "sales_order_currency_check" CHECK ("sales_order"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "sales_order_subtotal_amount_check" CHECK ("sales_order"."subtotal_amount" >= 0 AND "sales_order"."subtotal_amount" <= 1000000000000),
	CONSTRAINT "sales_order_shipping_total_check" CHECK ("sales_order"."shipping_total" >= 0 AND "sales_order"."shipping_total" <= 1000000000000),
	CONSTRAINT "sales_order_discount_total_check" CHECK ("sales_order"."discount_total" <= 0 AND "sales_order"."discount_total" >= -1000000000000),
	CONSTRAINT "sales_order_tax_total_check" CHECK ("sales_order"."tax_total" >= 0 AND "sales_order"."tax_total" <= 1000000000000),
	CONSTRAINT "sales_order_total_amount_check" CHECK ("sales_order"."total_amount" >= 0 AND "sales_order"."total_amount" <= 1000000000000),
	CONSTRAINT "sales_order_access_token_hash_check" CHECK ("sales_order"."access_token_hash" IS NULL OR "sales_order"."access_token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "sales_order_access_pair_check" CHECK (("sales_order"."access_token_hash" IS NULL) = ("sales_order"."access_expires_at" IS NULL)),
	CONSTRAINT "sales_order_customer_or_token_check" CHECK ("sales_order"."customer_id" IS NULL OR "sales_order"."access_token_hash" IS NULL),
	CONSTRAINT "sales_order_request_fingerprint_check" CHECK ("sales_order"."request_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "sales_order_expires_at_check" CHECK ("sales_order"."expires_at" > "sales_order"."placed_at"),
	CONSTRAINT "sales_order_cancellation_reason_check" CHECK ("sales_order"."cancellation_reason" IS NULL OR char_length("sales_order"."cancellation_reason") BETWEEN 1 AND 500),
	CONSTRAINT "sales_order_payment_reference_check" CHECK ("sales_order"."payment_reference" IS NULL OR char_length("sales_order"."payment_reference") BETWEEN 1 AND 255)
);
--> statement-breakpoint
CREATE TABLE "domain_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	CONSTRAINT "domain_event_type_check" CHECK ("domain_event"."type" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
	CONSTRAINT "domain_event_payload_check" CHECK (jsonb_typeof("domain_event"."payload") = 'object'),
	CONSTRAINT "domain_event_attempts_check" CHECK ("domain_event"."attempts" >= 0),
	CONSTRAINT "domain_event_last_error_code_check" CHECK ("domain_event"."last_error_code" IS NULL OR "domain_event"."last_error_code" ~ '^[A-Za-z0-9_.:-]{1,64}$')
);
--> statement-breakpoint
ALTER TABLE "customer_session" ADD CONSTRAINT "customer_session_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart" ADD CONSTRAINT "cart_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_item" ADD CONSTRAINT "cart_item_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "public"."cart"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_item" ADD CONSTRAINT "cart_item_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."variant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_adjustment" ADD CONSTRAINT "order_adjustment_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."sales_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."sales_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."variant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_reservation" ADD CONSTRAINT "order_item_reservation_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_reservation" ADD CONSTRAINT "order_item_reservation_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_change" ADD CONSTRAINT "order_status_change_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."sales_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_change" ADD CONSTRAINT "order_status_change_actor_admin_id_fkey" FOREIGN KEY ("actor_admin_id") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_session_customer_id_idx" ON "customer_session" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_session_expires_at_idx" ON "customer_session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "cart_expires_at_idx" ON "cart" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "cart_item_variant_id_idx" ON "cart_item" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "order_adjustment_order_id_idx" ON "order_adjustment" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_item_product_id_idx" ON "order_item" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "order_item_variant_id_idx" ON "order_item" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "order_status_change_order_id_created_at_idx" ON "order_status_change" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "order_status_change_actor_admin_id_idx" ON "order_status_change" USING btree ("actor_admin_id");--> statement-breakpoint
CREATE INDEX "sales_order_customer_id_placed_at_idx" ON "sales_order" USING btree ("customer_id","placed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sales_order_status_expires_at_idx" ON "sales_order" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "sales_order_placed_at_idx" ON "sales_order" USING btree ("placed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sales_order_email_idx" ON "sales_order" USING btree ("email");--> statement-breakpoint
CREATE INDEX "domain_event_dispatched_at_created_at_idx" ON "domain_event" USING btree ("dispatched_at","created_at") WHERE "domain_event"."dispatched_at" IS NULL;--> statement-breakpoint
-- Hand-written part (drizzle-kit models neither triggers nor data). See docs/adr/0019-orders-schema.md and, for the
-- technique, docs/adr/0012-pricing-inventory-schema.md. pg_trigger_depth() is 1 for a statement run by a client and
-- greater than 1 inside a referential action, so every exception below is exactly one foreign key action of its table.
-- Everything else is rejected with SQLSTATE 23001 (restrict_violation).

-- order_item is the immutable purchase snapshot. Allowed at depth above 1 only:
--   DELETE: the cascade from sales_order (the application never deletes orders; this keeps a test or an erasure plan possible);
--   UPDATE: the SET NULL of product_id and/or variant_id when the catalog row is deleted, with every other column identical.
CREATE FUNCTION "order_item_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF pg_trigger_depth() > 1 THEN
		IF TG_OP = 'DELETE' THEN
			RETURN OLD;
		END IF;
		IF (NEW.product_id IS NOT DISTINCT FROM OLD.product_id OR (OLD.product_id IS NOT NULL AND NEW.product_id IS NULL))
			AND (NEW.variant_id IS NOT DISTINCT FROM OLD.variant_id OR (OLD.variant_id IS NOT NULL AND NEW.variant_id IS NULL))
			AND to_jsonb(NEW) - 'product_id' - 'variant_id' = to_jsonb(OLD) - 'product_id' - 'variant_id' THEN
			RETURN NEW;
		END IF;
	END IF;
	RAISE EXCEPTION 'order_item is immutable: % is not allowed', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "order_item_immutable" BEFORE UPDATE OR DELETE ON "order_item" FOR EACH ROW EXECUTE FUNCTION "order_item_immutable"();--> statement-breakpoint
-- order_adjustment is append-only. Allowed at depth above 1 only: DELETE, the cascade from sales_order. It has no
-- SET NULL foreign key, so an UPDATE is never allowed.
CREATE FUNCTION "order_adjustment_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF pg_trigger_depth() > 1 AND TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION 'order_adjustment is append-only: % is not allowed', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "order_adjustment_append_only" BEFORE UPDATE OR DELETE ON "order_adjustment" FOR EACH ROW EXECUTE FUNCTION "order_adjustment_append_only"();--> statement-breakpoint
-- order_status_change is the append-only status journal. Allowed at depth above 1 only: DELETE (the cascade from
-- sales_order) and the SET NULL of actor_admin_id when the admin user is deleted, with every other column identical
-- (the same exception as stock_movement.actor_id).
CREATE FUNCTION "order_status_change_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
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
	RAISE EXCEPTION 'order_status_change is append-only: % is not allowed', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "order_status_change_append_only" BEFORE UPDATE OR DELETE ON "order_status_change" FOR EACH ROW EXECUTE FUNCTION "order_status_change_append_only"();