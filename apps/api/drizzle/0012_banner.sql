CREATE TABLE "banner" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"layout" text DEFAULT 'card' NOT NULL,
	"title" jsonb,
	"text" jsonb,
	"image_alt" jsonb,
	"image_upload_id" uuid NOT NULL,
	"link" text NOT NULL,
	"tone" text DEFAULT 'surface' NOT NULL,
	"position" integer NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "banner_layout_check" CHECK ("banner"."layout" IN ('card', 'image')),
	CONSTRAINT "banner_tone_check" CHECK ("banner"."tone" IN ('surface', 'accent')),
	CONSTRAINT "banner_title_check" CHECK ("banner"."title" IS NULL OR jsonb_typeof("banner"."title") = 'object'),
	CONSTRAINT "banner_text_check" CHECK ("banner"."text" IS NULL OR jsonb_typeof("banner"."text") = 'object'),
	CONSTRAINT "banner_image_alt_check" CHECK ("banner"."image_alt" IS NULL OR jsonb_typeof("banner"."image_alt") = 'object'),
	CONSTRAINT "banner_link_check" CHECK (char_length("banner"."link") BETWEEN 1 AND 2048),
	CONSTRAINT "banner_window_check" CHECK ("banner"."starts_at" IS NULL OR "banner"."ends_at" IS NULL OR "banner"."ends_at" > "banner"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "banner_image" (
	"banner_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"image_upload_id" uuid NOT NULL,
	CONSTRAINT "banner_image_pkey" PRIMARY KEY("banner_id","locale"),
	CONSTRAINT "banner_image_locale_check" CHECK ("banner_image"."locale" ~ '^[a-z]{2,8}(-[a-z]{2,8})*$')
);
--> statement-breakpoint
ALTER TABLE "banner" ADD CONSTRAINT "banner_image_upload_id_fkey" FOREIGN KEY ("image_upload_id") REFERENCES "public"."media_upload"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banner_image" ADD CONSTRAINT "banner_image_banner_id_fkey" FOREIGN KEY ("banner_id") REFERENCES "public"."banner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banner_image" ADD CONSTRAINT "banner_image_image_upload_id_fkey" FOREIGN KEY ("image_upload_id") REFERENCES "public"."media_upload"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "banner_position_idx" ON "banner" USING btree ("position","id");--> statement-breakpoint
CREATE INDEX "banner_image_upload_id_idx" ON "banner" USING btree ("image_upload_id");--> statement-breakpoint
CREATE INDEX "banner_image_image_upload_id_idx" ON "banner_image" USING btree ("image_upload_id");