CREATE TABLE "attribute" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb,
	"input_type" text NOT NULL,
	"is_localized" boolean NOT NULL,
	"unit" text,
	"validation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_filterable" boolean DEFAULT false NOT NULL,
	"is_searchable" boolean DEFAULT false NOT NULL,
	"is_comparable" boolean DEFAULT false NOT NULL,
	"is_sortable" boolean DEFAULT false NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"is_visible_on_storefront" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attribute_code_key" UNIQUE("code"),
	CONSTRAINT "attribute_code_check" CHECK ("attribute"."code" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "attribute_name_check" CHECK (jsonb_typeof("attribute"."name") = 'object' AND "attribute"."name" <> '{}'::jsonb),
	CONSTRAINT "attribute_description_check" CHECK ("attribute"."description" IS NULL OR jsonb_typeof("attribute"."description") = 'object'),
	CONSTRAINT "attribute_input_type_check" CHECK ("attribute"."input_type" IN ('text', 'number', 'boolean', 'select', 'multiselect', 'date')),
	CONSTRAINT "attribute_unit_check" CHECK ("attribute"."unit" IS NULL OR "attribute"."input_type" = 'number'),
	CONSTRAINT "attribute_is_localized_check" CHECK (NOT "attribute"."is_localized" OR "attribute"."input_type" = 'text'),
	CONSTRAINT "attribute_is_internal_check" CHECK (NOT "attribute"."is_internal" OR NOT ("attribute"."is_visible_on_storefront" OR "attribute"."is_filterable" OR "attribute"."is_searchable" OR "attribute"."is_comparable" OR "attribute"."is_sortable")),
	CONSTRAINT "attribute_is_sortable_check" CHECK (NOT "attribute"."is_sortable" OR "attribute"."input_type" IN ('number', 'date')),
	CONSTRAINT "attribute_is_filterable_check" CHECK (NOT "attribute"."is_filterable" OR "attribute"."input_type" IN ('select', 'multiselect', 'boolean', 'number')),
	CONSTRAINT "attribute_validation_check" CHECK (jsonb_typeof("attribute"."validation") = 'object')
);
--> statement-breakpoint
CREATE TABLE "attribute_option" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attribute_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attribute_option_attribute_id_code_key" UNIQUE("attribute_id","code"),
	CONSTRAINT "attribute_option_code_check" CHECK ("attribute_option"."code" ~ '^[a-z0-9][a-z0-9_]{0,63}$'),
	CONSTRAINT "attribute_option_label_check" CHECK (jsonb_typeof("attribute_option"."label") = 'object' AND "attribute_option"."label" <> '{}'::jsonb)
);
--> statement-breakpoint
CREATE TABLE "brand" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_slug_key" UNIQUE("slug"),
	CONSTRAINT "brand_slug_check" CHECK ("brand"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("brand"."slug") <= 160),
	CONSTRAINT "brand_name_check" CHECK (jsonb_typeof("brand"."name") = 'object' AND "brand"."name" <> '{}'::jsonb),
	CONSTRAINT "brand_description_check" CHECK ("brand"."description" IS NULL OR jsonb_typeof("brand"."description") = 'object')
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"slug" text NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_slug_key" UNIQUE("slug"),
	CONSTRAINT "category_slug_check" CHECK ("category"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("category"."slug") <= 160),
	CONSTRAINT "category_name_check" CHECK (jsonb_typeof("category"."name") = 'object' AND "category"."name" <> '{}'::jsonb),
	CONSTRAINT "category_description_check" CHECK ("category"."description" IS NULL OR jsonb_typeof("category"."description") = 'object'),
	CONSTRAINT "category_parent_id_check" CHECK ("category"."parent_id" IS DISTINCT FROM "category"."id")
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"option_id" uuid,
	"option_value_id" uuid,
	"url" text NOT NULL,
	"alt" jsonb,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_option_pair_check" CHECK (("media"."option_id" IS NULL) = ("media"."option_value_id" IS NULL)),
	CONSTRAINT "media_alt_check" CHECK ("media"."alt" IS NULL OR jsonb_typeof("media"."alt") = 'object')
);
--> statement-breakpoint
CREATE TABLE "option" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "option_code_key" UNIQUE("code"),
	CONSTRAINT "option_code_check" CHECK ("option"."code" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "option_name_check" CHECK (jsonb_typeof("option"."name") = 'object' AND "option"."name" <> '{}'::jsonb)
);
--> statement-breakpoint
CREATE TABLE "option_value" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"option_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "option_value_option_id_code_key" UNIQUE("option_id","code"),
	CONSTRAINT "option_value_id_option_id_key" UNIQUE("id","option_id"),
	CONSTRAINT "option_value_code_check" CHECK ("option_value"."code" ~ '^[a-z0-9][a-z0-9_]{0,63}$'),
	CONSTRAINT "option_value_label_check" CHECK (jsonb_typeof("option_value"."label") = 'object' AND "option_value"."label" <> '{}'::jsonb)
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_type_id" uuid NOT NULL,
	"brand_id" uuid,
	"slug" text NOT NULL,
	"title" jsonb NOT NULL,
	"description" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_slug_key" UNIQUE("slug"),
	CONSTRAINT "product_slug_check" CHECK ("product"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("product"."slug") <= 160),
	CONSTRAINT "product_title_check" CHECK (jsonb_typeof("product"."title") = 'object' AND "product"."title" <> '{}'::jsonb),
	CONSTRAINT "product_description_check" CHECK ("product"."description" IS NULL OR jsonb_typeof("product"."description") = 'object'),
	CONSTRAINT "product_status_check" CHECK ("product"."status" IN ('draft', 'active', 'archived')),
	CONSTRAINT "product_attributes_check" CHECK (jsonb_typeof("product"."attributes") = 'object'),
	CONSTRAINT "product_published_at_check" CHECK ("product"."status" <> 'active' OR "product"."published_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "product_category" (
	"product_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_category_pkey" PRIMARY KEY("product_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "product_option" (
	"product_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_option_pkey" PRIMARY KEY("product_id","option_id")
);
--> statement-breakpoint
CREATE TABLE "product_option_value" (
	"product_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"option_value_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_option_value_pkey" PRIMARY KEY("product_id","option_id","option_value_id")
);
--> statement-breakpoint
CREATE TABLE "product_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" jsonb NOT NULL,
	"requires_shipping" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_type_code_key" UNIQUE("code"),
	CONSTRAINT "product_type_code_check" CHECK ("product_type"."code" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "product_type_name_check" CHECK (jsonb_typeof("product_type"."name") = 'object' AND "product_type"."name" <> '{}'::jsonb)
);
--> statement-breakpoint
CREATE TABLE "product_type_attribute" (
	"product_type_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"level" text NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_type_attribute_pkey" PRIMARY KEY("product_type_id","attribute_id"),
	CONSTRAINT "product_type_attribute_level_check" CHECK ("product_type_attribute"."level" IN ('product', 'variant'))
);
--> statement-breakpoint
CREATE TABLE "product_type_option" (
	"product_type_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_type_option_pkey" PRIMARY KEY("product_type_id","option_id")
);
--> statement-breakpoint
CREATE TABLE "variant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"barcode" text,
	"title" jsonb,
	"option_signature" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variant_sku_key" UNIQUE("sku"),
	CONSTRAINT "variant_product_id_option_signature_key" UNIQUE("product_id","option_signature"),
	CONSTRAINT "variant_id_product_id_key" UNIQUE("id","product_id"),
	CONSTRAINT "variant_sku_check" CHECK ("variant"."sku" ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'),
	CONSTRAINT "variant_title_check" CHECK ("variant"."title" IS NULL OR jsonb_typeof("variant"."title") = 'object'),
	CONSTRAINT "variant_attributes_check" CHECK (jsonb_typeof("variant"."attributes") = 'object')
);
--> statement-breakpoint
CREATE TABLE "variant_option_value" (
	"variant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"option_value_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variant_option_value_pkey" PRIMARY KEY("variant_id","option_id")
);
--> statement-breakpoint
ALTER TABLE "attribute_option" ADD CONSTRAINT "attribute_option_attribute_id_fkey" FOREIGN KEY ("attribute_id") REFERENCES "public"."attribute"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."category"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_product_option_value_fkey" FOREIGN KEY ("product_id","option_id","option_value_id") REFERENCES "public"."product_option_value"("product_id","option_id","option_value_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_value" ADD CONSTRAINT "option_value_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "public"."option"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_product_type_id_fkey" FOREIGN KEY ("product_type_id") REFERENCES "public"."product_type"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_category" ADD CONSTRAINT "product_category_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_category" ADD CONSTRAINT "product_category_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option" ADD CONSTRAINT "product_option_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option" ADD CONSTRAINT "product_option_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "public"."option"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_value" ADD CONSTRAINT "product_option_value_product_option_fkey" FOREIGN KEY ("product_id","option_id") REFERENCES "public"."product_option"("product_id","option_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_value" ADD CONSTRAINT "product_option_value_option_value_fkey" FOREIGN KEY ("option_value_id","option_id") REFERENCES "public"."option_value"("id","option_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_type_attribute" ADD CONSTRAINT "product_type_attribute_product_type_id_fkey" FOREIGN KEY ("product_type_id") REFERENCES "public"."product_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_type_attribute" ADD CONSTRAINT "product_type_attribute_attribute_id_fkey" FOREIGN KEY ("attribute_id") REFERENCES "public"."attribute"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_type_option" ADD CONSTRAINT "product_type_option_product_type_id_fkey" FOREIGN KEY ("product_type_id") REFERENCES "public"."product_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_type_option" ADD CONSTRAINT "product_type_option_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "public"."option"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant" ADD CONSTRAINT "variant_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_option_value" ADD CONSTRAINT "variant_option_value_variant_fkey" FOREIGN KEY ("variant_id","product_id") REFERENCES "public"."variant"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_option_value" ADD CONSTRAINT "variant_option_value_product_option_value_fkey" FOREIGN KEY ("product_id","option_id","option_value_id") REFERENCES "public"."product_option_value"("product_id","option_id","option_value_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attribute_option_attribute_id_position_idx" ON "attribute_option" USING btree ("attribute_id","position");--> statement-breakpoint
CREATE INDEX "category_parent_id_position_idx" ON "category" USING btree ("parent_id","position");--> statement-breakpoint
CREATE INDEX "media_product_id_position_idx" ON "media" USING btree ("product_id","position");--> statement-breakpoint
CREATE INDEX "option_value_option_id_position_idx" ON "option_value" USING btree ("option_id","position");--> statement-breakpoint
CREATE INDEX "product_status_published_at_id_idx" ON "product" USING btree ("status","published_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "product_brand_id_idx" ON "product" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "product_product_type_id_idx" ON "product" USING btree ("product_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_category_product_id_primary_key" ON "product_category" USING btree ("product_id") WHERE "product_category"."is_primary";--> statement-breakpoint
CREATE INDEX "product_category_category_id_position_product_id_idx" ON "product_category" USING btree ("category_id","position","product_id");--> statement-breakpoint
CREATE INDEX "product_option_option_id_idx" ON "product_option" USING btree ("option_id");--> statement-breakpoint
CREATE INDEX "product_option_value_option_value_id_idx" ON "product_option_value" USING btree ("option_value_id");--> statement-breakpoint
CREATE INDEX "product_type_attribute_attribute_id_idx" ON "product_type_attribute" USING btree ("attribute_id");--> statement-breakpoint
CREATE INDEX "product_type_option_option_id_idx" ON "product_type_option" USING btree ("option_id");--> statement-breakpoint
CREATE UNIQUE INDEX "variant_product_id_default_key" ON "variant" USING btree ("product_id") WHERE "variant"."is_default";--> statement-breakpoint
CREATE INDEX "variant_product_id_position_idx" ON "variant" USING btree ("product_id","position");--> statement-breakpoint
CREATE INDEX "variant_option_value_product_option_value_idx" ON "variant_option_value" USING btree ("product_id","option_id","option_value_id");