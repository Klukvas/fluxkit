import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { I18nText } from "./catalog.js";
import { mediaUpload } from "./media.js";

/**
 * Home page banners managed in the admin (ADR 0046, migration 0012). Core content, no feature flag. Texts are JSONB
 * locale maps like the catalog's; which locales are allowed, the default locale, the layout rules and the link rule are
 * service rules (`packages/core/src/content`). Pictures are uploads (ADR 0028) referenced by id: the foreign keys keep
 * an upload row from being deleted while a banner uses it, and the save marks every picture attached so the cleanup
 * job 7 never deletes it. Naming conventions of `catalog.ts`.
 */
export const banner = pgTable(
  "banner",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    layout: text("layout").notNull().default("card"),
    title: jsonb("title").$type<I18nText>(),
    text: jsonb("text").$type<I18nText>(),
    imageAlt: jsonb("image_alt").$type<I18nText>(),
    // The default picture, shown for every locale without its own row in `banner_image`.
    imageUploadId: uuid("image_upload_id").notNull(),
    // A storefront path without a locale prefix or an https address (core `checkBannerLink`).
    link: text("link").notNull(),
    tone: text("tone").notNull().default("surface"),
    // Rewritten 0..n-1 by the reorder route; no unique constraint, ties are ordered by id.
    position: integer("position").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    // Half-open window [starts_at, ends_at); NULL is an open bound.
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("banner_layout_check", sql`${t.layout} IN ('card', 'image')`),
    check("banner_tone_check", sql`${t.tone} IN ('surface', 'accent')`),
    check("banner_title_check", sql`${t.title} IS NULL OR jsonb_typeof(${t.title}) = 'object'`),
    check("banner_text_check", sql`${t.text} IS NULL OR jsonb_typeof(${t.text}) = 'object'`),
    check(
      "banner_image_alt_check",
      sql`${t.imageAlt} IS NULL OR jsonb_typeof(${t.imageAlt}) = 'object'`,
    ),
    check("banner_link_check", sql`char_length(${t.link}) BETWEEN 1 AND 2048`),
    check(
      "banner_window_check",
      sql`${t.startsAt} IS NULL OR ${t.endsAt} IS NULL OR ${t.endsAt} > ${t.startsAt}`,
    ),
    foreignKey({
      name: "banner_image_upload_id_fkey",
      columns: [t.imageUploadId],
      foreignColumns: [mediaUpload.id],
    }).onDelete("restrict"),
    index("banner_position_idx").on(t.position, t.id),
    index("banner_image_upload_id_idx").on(t.imageUploadId),
  ],
);

/** A banner's own picture for one content locale (owner decision 2026-11-05); a locale without a row shows the default. */
export const bannerImage = pgTable(
  "banner_image",
  {
    bannerId: uuid("banner_id").notNull(),
    locale: text("locale").notNull(),
    imageUploadId: uuid("image_upload_id").notNull(),
  },
  (t) => [
    primaryKey({ name: "banner_image_pkey", columns: [t.bannerId, t.locale] }),
    foreignKey({
      name: "banner_image_banner_id_fkey",
      columns: [t.bannerId],
      foreignColumns: [banner.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "banner_image_image_upload_id_fkey",
      columns: [t.imageUploadId],
      foreignColumns: [mediaUpload.id],
    }).onDelete("restrict"),
    // Same shape as the configured locale codes (`@fluxkit/config`); which ones are allowed is a service rule.
    check("banner_image_locale_check", sql`${t.locale} ~ '^[a-z]{2,8}(-[a-z]{2,8})*$'`),
    index("banner_image_image_upload_id_idx").on(t.imageUploadId),
  ],
);
