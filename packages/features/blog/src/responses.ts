import type { MarkdownDocument, MediaUploadDescription } from "@fluxkit/core";
import type { BlogPostState, BlogPostStatus } from "./rules.js";
import type { LocaleTexts } from "./schema.js";

/*
 * Response shapes of the blog routes (docs/api/features-blog.md). Store answers carry public fields only: never the status,
 * an id, an upload id or a text of another locale (plan section 11).
 */

export interface AdminCover {
  uploadId: string;
  url: string;
  width: number;
  height: number;
}

/** `GET /admin/blog/posts` items: no bodies. */
export interface AdminPostSummary {
  id: string;
  slug: string;
  status: BlogPostStatus;
  state: BlogPostState;
  title: LocaleTexts;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The full post of the admin: every locale, the Markdown sources, the cover upload id and its URL. */
export interface AdminPost extends AdminPostSummary {
  /** True once the post was first published: the slug can no longer change. */
  slugLocked: boolean;
  excerpt: LocaleTexts | null;
  body: LocaleTexts;
  seoTitle: LocaleTexts | null;
  seoDescription: LocaleTexts | null;
  coverUploadId: string | null;
  /** `null` without a cover, or when its upload can no longer be described. */
  cover: AdminCover | null;
  coverAlt: LocaleTexts | null;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface StoreCover {
  url: string;
  width: number;
  height: number;
  /** `null` = decorative picture. */
  alt: string | null;
}

export interface StorePostSummary {
  slug: string;
  title: string;
  excerpt: string | null;
  publishedAt: string;
  updatedAt: string;
  cover: StoreCover | null;
}

export interface StorePost extends StorePostSummary {
  seoTitle: string | null;
  seoDescription: string | null;
  /** The parsed body of the requested locale (ADR 0050), never HTML. */
  content: MarkdownDocument;
  /** The content locales this post is written in (title and body), in the configured order: its hreflang alternates. */
  locales: string[];
}

export interface StoreSitemap {
  items: { slug: string; updatedAt: string; locales: string[] }[];
  /** True when more public posts exist than the route lists (the newest 5 000 are listed). */
  truncated: boolean;
}

export function adminCover(upload: MediaUploadDescription | undefined): AdminCover | null {
  return upload === undefined
    ? null
    : { uploadId: upload.id, url: upload.url, width: upload.width, height: upload.height };
}

/** A locale's own text, or `null`: a public post shows no text of another language (owner's answer 6 (a)). */
export function ownText(texts: LocaleTexts | null, locale: string): string | null {
  if (texts === null || !Object.hasOwn(texts, locale)) return null;
  const value = texts[locale];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
