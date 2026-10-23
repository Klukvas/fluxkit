import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { adminUser } from "./admin-auth.js";

/**
 * Uploaded media files (ADR 0028 decision 5, migration 0005). One row per stored file; the file itself lives in the
 * storage driver under `storage_key`. Product media and brand logos keep referencing the file by its public URL
 * (`media.url`, `brand.logo_url`): this table has no foreign key from them, and they have none to it.
 * `first_attached_at` is set the first time a media list or a brand references the upload; rows where it is still null
 * after 24 hours are abandoned and deleted by the cleanup job (plan step 5). Same naming conventions as `catalog.ts`.
 */
export const mediaUpload = pgTable(
  "media_upload",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    // Hex SHA-256 of the stored bytes; not unique: two uploads of one picture stay two rows.
    sha256: text("sha256").notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    firstAttachedAt: timestamp("first_attached_at", { withTimezone: true }),
  },
  (t) => [
    unique("media_upload_storage_key_key").on(t.storageKey),
    // The same pattern as `isMediaKey` of packages/core (media/key.ts); media-upload-schema.spec.ts compares both.
    check(
      "media_upload_storage_key_check",
      sql`${t.storageKey} ~ '^[0-9a-f]{32}\\.(jpg|png|webp)$'`,
    ),
    check(
      "media_upload_content_type_check",
      sql`${t.contentType} IN ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    check("media_upload_byte_size_check", sql`${t.byteSize} > 0`),
    check("media_upload_width_check", sql`${t.width} > 0`),
    check("media_upload_height_check", sql`${t.height} > 0`),
    check("media_upload_sha256_check", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    foreignKey({
      name: "media_upload_created_by_fkey",
      columns: [t.createdBy],
      foreignColumns: [adminUser.id],
    }).onDelete("set null"),
    // The cleanup job reads only never-attached rows, oldest first.
    index("media_upload_created_at_unattached_idx")
      .on(t.createdAt)
      .where(sql`${t.firstAttachedAt} IS NULL`),
  ],
);
