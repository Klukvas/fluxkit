CREATE TABLE "fixture_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" jsonb NOT NULL,
	"cover_upload_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fixture_note_title_check" CHECK (jsonb_typeof("fixture_note"."title") = 'object')
);
--> statement-breakpoint
-- Added by hand (ADR 0049): a feature schema cannot import the core media_upload table, so the foreign key to it is not
-- declared in schema.ts and the drift check never sees it; fixture-feature.spec.ts asserts it in the migrated database.
ALTER TABLE "fixture_note" ADD CONSTRAINT "fixture_note_cover_upload_id_fkey" FOREIGN KEY ("cover_upload_id") REFERENCES "public"."media_upload"("id") ON DELETE RESTRICT;
