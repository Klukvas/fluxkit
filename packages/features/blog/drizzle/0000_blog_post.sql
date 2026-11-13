CREATE TABLE "blog_post" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"title" jsonb NOT NULL,
	"excerpt" jsonb,
	"body" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"seo_title" jsonb,
	"seo_description" jsonb,
	"cover_upload_id" uuid,
	"cover_alt" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blog_post_slug_key" UNIQUE("slug"),
	CONSTRAINT "blog_post_status_check" CHECK ("blog_post"."status" in ('draft', 'published')),
	CONSTRAINT "blog_post_published_at_check" CHECK ("blog_post"."status" = 'draft' or "blog_post"."published_at" is not null),
	CONSTRAINT "blog_post_title_check" CHECK (jsonb_typeof("blog_post"."title") = 'object'),
	CONSTRAINT "blog_post_excerpt_check" CHECK ("blog_post"."excerpt" is null or jsonb_typeof("blog_post"."excerpt") = 'object'),
	CONSTRAINT "blog_post_body_check" CHECK (jsonb_typeof("blog_post"."body") = 'object'),
	CONSTRAINT "blog_post_seo_title_check" CHECK ("blog_post"."seo_title" is null or jsonb_typeof("blog_post"."seo_title") = 'object'),
	CONSTRAINT "blog_post_seo_description_check" CHECK ("blog_post"."seo_description" is null or jsonb_typeof("blog_post"."seo_description") = 'object'),
	CONSTRAINT "blog_post_cover_alt_check" CHECK ("blog_post"."cover_alt" is null or jsonb_typeof("blog_post"."cover_alt") = 'object')
);
--> statement-breakpoint
CREATE INDEX "blog_post_public_idx" ON "blog_post" USING btree ("published_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "blog_post"."status" = 'published';--> statement-breakpoint
CREATE INDEX "blog_post_updated_idx" ON "blog_post" USING btree ("updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
-- Added by hand (ADR 0049): a feature schema cannot import the core media_upload table, so the foreign key to it is not
-- declared in src/schema.ts and the drift check never sees it; src/migration.spec.ts asserts it in the migrated database.
ALTER TABLE "blog_post" ADD CONSTRAINT "blog_post_cover_upload_id_fkey" FOREIGN KEY ("cover_upload_id") REFERENCES "public"."media_upload"("id") ON DELETE RESTRICT;
