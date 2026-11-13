import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

/*
 * Test fixture only (ADR 0049): the table of the `notebook` fixture feature. `cover_upload_id` is a plain uuid here; its
 * foreign key to the core `media_upload` table is added by hand at the end of the generated migration, the way a real
 * feature references a core table it cannot import.
 */
export const fixtureNote = pgTable(
  "fixture_note",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: jsonb("title").$type<Record<string, string>>().notNull(),
    coverUploadId: uuid("cover_upload_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("fixture_note_title_check", sql`jsonb_typeof(${t.title}) = 'object'`)],
);
