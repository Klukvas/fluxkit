CREATE TABLE "inventory_level" (
	"variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"on_hand" integer NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_level_pkey" PRIMARY KEY("variant_id","location_id"),
	CONSTRAINT "inventory_level_on_hand_check" CHECK ("inventory_level"."on_hand" >= 0 AND "inventory_level"."on_hand" <= 1000000000),
	CONSTRAINT "inventory_level_reserved_check" CHECK ("inventory_level"."reserved" >= 0)
);
--> statement-breakpoint
CREATE TABLE "location" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_code_key" UNIQUE("code"),
	CONSTRAINT "location_code_check" CHECK ("location"."code" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "location_name_check" CHECK ("location"."name" <> '')
);
--> statement-breakpoint
CREATE TABLE "price" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"amount" bigint NOT NULL,
	"compare_at_amount" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_variant_id_currency_key" UNIQUE("variant_id","currency"),
	CONSTRAINT "price_currency_check" CHECK ("price"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "price_amount_check" CHECK ("price"."amount" >= 0 AND "price"."amount" <= 1000000000000),
	CONSTRAINT "price_compare_at_amount_check" CHECK ("price"."compare_at_amount" IS NULL OR ("price"."compare_at_amount" > "price"."amount" AND "price"."compare_at_amount" <= 1000000000000))
);
--> statement-breakpoint
CREATE TABLE "reservation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_quantity_check" CHECK ("reservation"."quantity" > 0 AND "reservation"."quantity" <= 1000000),
	CONSTRAINT "reservation_status_check" CHECK ("reservation"."status" IN ('active', 'committed', 'released', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "stock_movement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"kind" text NOT NULL,
	"on_hand_after" integer NOT NULL,
	"reason" text,
	"reference" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movement_delta_check" CHECK ("stock_movement"."delta" <> 0),
	CONSTRAINT "stock_movement_kind_check" CHECK ("stock_movement"."kind" IN ('receipt', 'adjustment', 'sale', 'return')),
	CONSTRAINT "stock_movement_on_hand_after_check" CHECK ("stock_movement"."on_hand_after" >= 0 AND "stock_movement"."on_hand_after" <= 1000000000)
);
--> statement-breakpoint
ALTER TABLE "variant" ADD COLUMN "track_inventory" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "variant" ADD COLUMN "allow_backorder" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_level" ADD CONSTRAINT "inventory_level_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."variant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_level" ADD CONSTRAINT "inventory_level_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price" ADD CONSTRAINT "price_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."variant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."variant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."variant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_level_location_id_idx" ON "inventory_level" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "location_is_default_key" ON "location" USING btree ("is_default") WHERE "location"."is_default";--> statement-breakpoint
CREATE INDEX "reservation_status_expires_at_idx" ON "reservation" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "reservation_variant_id_idx" ON "reservation" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "reservation_location_id_idx" ON "reservation" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "stock_movement_variant_id_created_at_idx" ON "stock_movement" USING btree ("variant_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "stock_movement_location_id_idx" ON "stock_movement" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "stock_movement_actor_id_idx" ON "stock_movement" USING btree ("actor_id");--> statement-breakpoint
-- Hand-written part (drizzle-kit models neither triggers nor data). See docs/adr/0012-pricing-inventory-schema.md.
-- Append-only journal: direct UPDATE and DELETE are rejected. pg_trigger_depth() is 1 for a statement run by a client
-- and greater than 1 inside a referential action, so the two exceptions are exactly the foreign keys of this table:
-- ON DELETE CASCADE from variant (the journal goes with a variant that is being deleted) and ON DELETE SET NULL from
-- admin_user (actor_id becomes null, nothing else may change).
CREATE FUNCTION "stock_movement_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF pg_trigger_depth() > 1 THEN
		IF TG_OP = 'DELETE' THEN
			RETURN OLD;
		END IF;
		IF OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL
			AND to_jsonb(NEW) - 'actor_id' = to_jsonb(OLD) - 'actor_id' THEN
			RETURN NEW;
		END IF;
	END IF;
	RAISE EXCEPTION 'stock_movement is append-only: % is not allowed', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "stock_movement_append_only" BEFORE UPDATE OR DELETE ON "stock_movement" FOR EACH ROW EXECUTE FUNCTION "stock_movement_append_only"();--> statement-breakpoint
-- The default location every installation starts with; a single-warehouse shop never needs to know about locations.
INSERT INTO "location" ("code", "name", "is_default") VALUES ('main', 'Main', true);