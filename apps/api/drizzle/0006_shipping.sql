CREATE TABLE "order_shipping" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"method_id" uuid,
	"method_code" text NOT NULL,
	"kind" text NOT NULL,
	"provider_code" text,
	"provider_service" text,
	"title" jsonb NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"payer" text NOT NULL,
	"estimated_carrier_amount" bigint,
	"destination" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_shipping_method_code_check" CHECK ("order_shipping"."method_code" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "order_shipping_kind_check" CHECK ("order_shipping"."kind" IN ('address', 'pickup_point', 'store_pickup')),
	CONSTRAINT "order_shipping_provider_code_check" CHECK ("order_shipping"."provider_code" IS NULL OR "order_shipping"."provider_code" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "order_shipping_provider_service_check" CHECK ("order_shipping"."provider_service" IS NULL OR ("order_shipping"."provider_code" IS NOT NULL AND char_length("order_shipping"."provider_service") BETWEEN 1 AND 64)),
	CONSTRAINT "order_shipping_title_check" CHECK (jsonb_typeof("order_shipping"."title") = 'object' AND "order_shipping"."title" <> '{}'::jsonb),
	CONSTRAINT "order_shipping_amount_check" CHECK ("order_shipping"."amount" >= 0 AND "order_shipping"."amount" <= 1000000000000),
	CONSTRAINT "order_shipping_currency_check" CHECK ("order_shipping"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "order_shipping_payer_check" CHECK ("order_shipping"."payer" IN ('shop_charge', 'recipient_on_delivery')),
	CONSTRAINT "order_shipping_payer_amount_check" CHECK ("order_shipping"."payer" <> 'recipient_on_delivery' OR "order_shipping"."amount" = 0),
	CONSTRAINT "order_shipping_estimated_carrier_amount_check" CHECK ("order_shipping"."estimated_carrier_amount" IS NULL OR ("order_shipping"."estimated_carrier_amount" >= 0 AND "order_shipping"."estimated_carrier_amount" <= 1000000000000)),
	CONSTRAINT "order_shipping_destination_check" CHECK (("order_shipping"."kind" = 'pickup_point' AND "order_shipping"."destination" IS NOT NULL AND jsonb_typeof("order_shipping"."destination") = 'object') OR ("order_shipping"."kind" <> 'pickup_point' AND "order_shipping"."destination" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "shipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider_code" text NOT NULL,
	"provider_service" text,
	"status" text NOT NULL,
	"carrier_status_code" text,
	"carrier_status_at" timestamp with time zone,
	"tracking_number" text,
	"provider_ref" text,
	"client_reference" text NOT NULL,
	"declared_value_amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"carrier_cost_amount" bigint,
	"payer" text NOT NULL,
	"weight_grams" integer NOT NULL,
	"length_mm" integer NOT NULL,
	"width_mm" integer NOT NULL,
	"height_mm" integer NOT NULL,
	"seats" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"next_track_at" timestamp with time zone,
	"tracking_attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "shipment_provider_code_tracking_number_key" UNIQUE("provider_code","tracking_number"),
	CONSTRAINT "shipment_provider_code_check" CHECK ("shipment"."provider_code" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "shipment_provider_service_check" CHECK ("shipment"."provider_service" IS NULL OR char_length("shipment"."provider_service") BETWEEN 1 AND 64),
	CONSTRAINT "shipment_status_check" CHECK ("shipment"."status" IN ('pending', 'unknown', 'created', 'in_transit', 'arrived', 'delivered', 'returning', 'returned', 'cancelled', 'failed')),
	CONSTRAINT "shipment_carrier_status_code_check" CHECK ("shipment"."carrier_status_code" IS NULL OR "shipment"."carrier_status_code" ~ '^[A-Za-z0-9_.-]{1,32}$'),
	CONSTRAINT "shipment_tracking_number_check" CHECK ("shipment"."tracking_number" IS NULL OR "shipment"."tracking_number" ~ '^[A-Za-z0-9_-]{1,64}$'),
	CONSTRAINT "shipment_provider_ref_check" CHECK ("shipment"."provider_ref" IS NULL OR "shipment"."provider_ref" ~ '^[A-Za-z0-9_-]{1,64}$'),
	CONSTRAINT "shipment_client_reference_check" CHECK ("shipment"."client_reference" ~ '^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'),
	CONSTRAINT "shipment_declared_value_amount_check" CHECK ("shipment"."declared_value_amount" >= 0 AND "shipment"."declared_value_amount" <= 1000000000000),
	CONSTRAINT "shipment_currency_check" CHECK ("shipment"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "shipment_carrier_cost_amount_check" CHECK ("shipment"."carrier_cost_amount" IS NULL OR ("shipment"."carrier_cost_amount" >= 0 AND "shipment"."carrier_cost_amount" <= 1000000000000)),
	CONSTRAINT "shipment_payer_check" CHECK ("shipment"."payer" IN ('sender', 'recipient')),
	CONSTRAINT "shipment_weight_grams_check" CHECK ("shipment"."weight_grams" > 0),
	CONSTRAINT "shipment_length_mm_check" CHECK ("shipment"."length_mm" > 0),
	CONSTRAINT "shipment_width_mm_check" CHECK ("shipment"."width_mm" > 0),
	CONSTRAINT "shipment_height_mm_check" CHECK ("shipment"."height_mm" > 0),
	CONSTRAINT "shipment_seats_check" CHECK ("shipment"."seats" BETWEEN 1 AND 1),
	CONSTRAINT "shipment_tracking_attempts_check" CHECK ("shipment"."tracking_attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shipment_status_change" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"carrier_status_code" text,
	"actor_type" text NOT NULL,
	"actor_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "shipment_status_change_from_status_check" CHECK ("shipment_status_change"."from_status" IS NULL OR "shipment_status_change"."from_status" IN ('pending', 'unknown', 'created', 'in_transit', 'arrived', 'delivered', 'returning', 'returned', 'cancelled', 'failed')),
	CONSTRAINT "shipment_status_change_to_status_check" CHECK ("shipment_status_change"."to_status" IN ('pending', 'unknown', 'created', 'in_transit', 'arrived', 'delivered', 'returning', 'returned', 'cancelled', 'failed')),
	CONSTRAINT "shipment_status_change_carrier_status_code_check" CHECK ("shipment_status_change"."carrier_status_code" IS NULL OR "shipment_status_change"."carrier_status_code" ~ '^[A-Za-z0-9_.-]{1,32}$'),
	CONSTRAINT "shipment_status_change_actor_type_check" CHECK ("shipment_status_change"."actor_type" IN ('admin', 'system'))
);
--> statement-breakpoint
CREATE TABLE "shipping_method" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"title" jsonb NOT NULL,
	"description" jsonb,
	"kind" text NOT NULL,
	"provider_code" text,
	"provider_service" text,
	"pricing" jsonb NOT NULL,
	"currency" text NOT NULL,
	"country_codes" text[] NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_method_code_key" UNIQUE("code"),
	CONSTRAINT "shipping_method_code_check" CHECK ("shipping_method"."code" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "shipping_method_title_check" CHECK (jsonb_typeof("shipping_method"."title") = 'object' AND "shipping_method"."title" <> '{}'::jsonb),
	CONSTRAINT "shipping_method_description_check" CHECK ("shipping_method"."description" IS NULL OR jsonb_typeof("shipping_method"."description") = 'object'),
	CONSTRAINT "shipping_method_kind_check" CHECK ("shipping_method"."kind" IN ('address', 'pickup_point', 'store_pickup')),
	CONSTRAINT "shipping_method_provider_code_check" CHECK ("shipping_method"."provider_code" IS NULL OR "shipping_method"."provider_code" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "shipping_method_provider_service_check" CHECK ("shipping_method"."provider_service" IS NULL OR ("shipping_method"."provider_code" IS NOT NULL AND char_length("shipping_method"."provider_service") BETWEEN 1 AND 64)),
	CONSTRAINT "shipping_method_pickup_point_provider_check" CHECK ("shipping_method"."kind" <> 'pickup_point' OR "shipping_method"."provider_code" IS NOT NULL),
	CONSTRAINT "shipping_method_pricing_check" CHECK (jsonb_typeof("shipping_method"."pricing") = 'object' AND ("shipping_method"."pricing" ->> 'type') IS NOT NULL AND ("shipping_method"."pricing" ->> 'type') IN ('flat', 'free_over', 'tiers', 'carrier_on_delivery')),
	CONSTRAINT "shipping_method_currency_check" CHECK ("shipping_method"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "shipping_method_country_codes_check" CHECK (array_ndims("shipping_method"."country_codes") = 1 AND cardinality("shipping_method"."country_codes") BETWEEN 1 AND 250 AND array_position("shipping_method"."country_codes", NULL) IS NULL AND array_to_string("shipping_method"."country_codes", ',') ~ '^[A-Z]{2}(,[A-Z]{2})*$' AND char_length(array_to_string("shipping_method"."country_codes", ',')) = 3 * cardinality("shipping_method"."country_codes") - 1),
	CONSTRAINT "shipping_method_position_check" CHECK ("shipping_method"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shipping_provider_setting" (
	"provider_code" text PRIMARY KEY NOT NULL,
	"settings" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "shipping_provider_setting_provider_code_check" CHECK ("shipping_provider_setting"."provider_code" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "shipping_provider_setting_settings_check" CHECK (jsonb_typeof("shipping_provider_setting"."settings") = 'object')
);
--> statement-breakpoint
ALTER TABLE "order_shipping" ADD CONSTRAINT "order_shipping_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."sales_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_shipping" ADD CONSTRAINT "order_shipping_method_id_fkey" FOREIGN KEY ("method_id") REFERENCES "public"."shipping_method"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."sales_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_status_change" ADD CONSTRAINT "shipment_status_change_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_status_change" ADD CONSTRAINT "shipment_status_change_actor_admin_id_fkey" FOREIGN KEY ("actor_admin_id") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_provider_setting" ADD CONSTRAINT "shipping_provider_setting_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_shipping_method_id_idx" ON "order_shipping" USING btree ("method_id");--> statement-breakpoint
CREATE INDEX "shipment_order_id_idx" ON "shipment" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_order_id_active_key" ON "shipment" USING btree ("order_id") WHERE "shipment"."status" NOT IN ('cancelled', 'failed');--> statement-breakpoint
CREATE INDEX "shipment_next_track_at_idx" ON "shipment" USING btree ("next_track_at") WHERE "shipment"."status" NOT IN ('delivered', 'returned', 'cancelled', 'failed');--> statement-breakpoint
CREATE INDEX "shipment_created_by_idx" ON "shipment" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "shipment_status_change_shipment_id_created_at_idx" ON "shipment_status_change" USING btree ("shipment_id","created_at");--> statement-breakpoint
CREATE INDEX "shipment_status_change_actor_admin_id_idx" ON "shipment_status_change" USING btree ("actor_admin_id");--> statement-breakpoint
CREATE INDEX "shipping_provider_setting_updated_by_idx" ON "shipping_provider_setting" USING btree ("updated_by");--> statement-breakpoint
-- Hand-written part (drizzle-kit models no triggers). See docs/adr/0029-shipping.md decision 7 and, for the technique,
-- docs/adr/0019-orders-schema.md. pg_trigger_depth() is 1 for a statement run by a client and greater than 1 inside a
-- referential action, so every exception below is exactly one foreign key action of its table. Everything else is
-- rejected with SQLSTATE 23001 (restrict_violation).

-- order_shipping is the immutable shipping snapshot of an order. Allowed at depth above 1 only:
--   DELETE: the cascade from sales_order (the application never deletes orders);
--   UPDATE: the SET NULL of method_id when the shipping method is deleted, with every other column identical.
CREATE FUNCTION "order_shipping_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF pg_trigger_depth() > 1 THEN
		IF TG_OP = 'DELETE' THEN
			RETURN OLD;
		END IF;
		IF OLD.method_id IS NOT NULL AND NEW.method_id IS NULL
			AND to_jsonb(NEW) - 'method_id' = to_jsonb(OLD) - 'method_id' THEN
			RETURN NEW;
		END IF;
	END IF;
	RAISE EXCEPTION 'order_shipping is immutable: % is not allowed', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "order_shipping_immutable" BEFORE UPDATE OR DELETE ON "order_shipping" FOR EACH ROW EXECUTE FUNCTION "order_shipping_immutable"();--> statement-breakpoint
-- shipment_status_change is the append-only status journal of a shipment. Allowed at depth above 1 only: DELETE (the
-- cascade from shipment) and the SET NULL of actor_admin_id when the admin user is deleted, with every other column
-- identical (the same exception as order_status_change.actor_admin_id).
CREATE FUNCTION "shipment_status_change_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
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
	RAISE EXCEPTION 'shipment_status_change is append-only: % is not allowed', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "shipment_status_change_append_only" BEFORE UPDATE OR DELETE ON "shipment_status_change" FOR EACH ROW EXECUTE FUNCTION "shipment_status_change_append_only"();
