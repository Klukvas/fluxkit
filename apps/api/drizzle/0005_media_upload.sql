CREATE TABLE "media_upload" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_attached_at" timestamp with time zone,
	CONSTRAINT "media_upload_storage_key_key" UNIQUE("storage_key"),
	CONSTRAINT "media_upload_storage_key_check" CHECK ("media_upload"."storage_key" ~ '^[0-9a-f]{32}\.(jpg|png|webp)$'),
	CONSTRAINT "media_upload_content_type_check" CHECK ("media_upload"."content_type" IN ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "media_upload_byte_size_check" CHECK ("media_upload"."byte_size" > 0),
	CONSTRAINT "media_upload_width_check" CHECK ("media_upload"."width" > 0),
	CONSTRAINT "media_upload_height_check" CHECK ("media_upload"."height" > 0),
	CONSTRAINT "media_upload_sha256_check" CHECK ("media_upload"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "media_upload" ADD CONSTRAINT "media_upload_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_upload_created_at_unattached_idx" ON "media_upload" USING btree ("created_at") WHERE "media_upload"."first_attached_at" IS NULL;