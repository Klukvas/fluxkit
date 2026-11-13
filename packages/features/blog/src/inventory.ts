import type { PersonalDataColumnEntry, PersonalDataInventory } from "@fluxkit/core";

/** The posts are public shop content: no author, no admin id (owner's answer 8 (a)). README "Personal data" repeats it. */
const PUBLIC_CONTENT: PersonalDataColumnEntry = Object.freeze({
  class: "none",
  ref: "FEATURE-BLOG",
  export: "not_applicable",
  erasure: "not_applicable",
});

const BLOG_POST_COLUMNS = [
  "id",
  "slug",
  "status",
  "published_at",
  "title",
  "excerpt",
  "body",
  "seo_title",
  "seo_description",
  "cover_upload_id",
  "cover_alt",
  "created_at",
  "updated_at",
] as const;

/**
 * Every column of the blog's tables, classified (ADR 0033, ADR 0049 E3). The API merges it with the core inventory at
 * startup; `inventory.spec.ts` checks it against the Drizzle schema.
 */
export const personalDataInventory: PersonalDataInventory = Object.freeze({
  blog_post: Object.freeze(
    Object.fromEntries(BLOG_POST_COLUMNS.map((column) => [column, PUBLIC_CONTENT])),
  ),
});
