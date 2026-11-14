import { Inject, Injectable } from "@nestjs/common";
import { LOCALE_CONFIG, MEDIA_PORT, type FieldError, type LocaleConfig } from "@fluxkit/api-kit";
import { generateUniqueSlug, slugLookupPrefix, type MediaPort } from "@fluxkit/core";
import { BlogRepository, type BlogExecutor, type BlogPostSummaryRow } from "./blog.repository.js";
import { bodyErrors, OPTIONAL_TEXT_RULES, slugErrors, textErrors, TITLE_RULE } from "./content.js";
import {
  isUniqueViolation,
  BLOG_POST_SLUG_CONSTRAINT,
  postNotFound,
  ruleViolation,
  slugTaken,
  validationFailed,
} from "./problems.js";
import { adminCover, type AdminPost, type AdminPostSummary, type Paged } from "./responses.js";
import {
  checkPublishedAt,
  missingTranslations,
  pageOffset,
  postState,
  type BlogPostStatus,
} from "./rules.js";
import type { BlogPostRow, LocaleTexts, NewBlogPostRow } from "./schema.js";
import type { AdminListQuery, CreatePostBody, PublishPostBody, UpdatePostBody } from "./schemas.js";

// A generated slug can lose a race against a concurrent create; each lost round means another request won.
const MAX_SLUG_ATTEMPTS = 5;

type ContentFields = Pick<
  CreatePostBody,
  "excerpt" | "seoTitle" | "seoDescription" | "coverAlt" | "body"
> & { title?: LocaleTexts };

/**
 * The admin side of the blog (plan sections 5 to 7): drafts, edits, publish, unpublish and delete. Every write is one
 * transaction; a cover upload is marked attached in it through `MEDIA_PORT` BEFORE the row that references it is written, so
 * an unknown id answers `upload_not_found` at `coverUploadId` (400) instead of a foreign-key error. No audit or domain event
 * (like banners and catalog edits).
 */
@Injectable()
export class AdminBlogService {
  constructor(
    private readonly posts: BlogRepository,
    @Inject(LOCALE_CONFIG) private readonly locale: LocaleConfig,
    @Inject(MEDIA_PORT) private readonly media: MediaPort,
  ) {}

  async list(query: AdminListQuery): Promise<Paged<AdminPostSummary>> {
    const offset = this.offsetOf(query.page, query.limit);
    const now = new Date();
    const { rows, total } = await this.posts.adminPage(query.status, now, {
      limit: query.limit,
      offset,
    });
    return {
      items: rows.map((row) => this.summary(row, now)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async get(id: string): Promise<AdminPost> {
    const row = await this.posts.findById(id);
    if (row === undefined) throw postNotFound();
    return this.full(row);
  }

  async create(body: CreatePostBody): Promise<AdminPost> {
    this.assertContent({ ...body, title: body.title }, true);
    if (body.slug !== undefined) this.assertValid(slugErrors(body.slug));
    const values: Omit<NewBlogPostRow, "slug"> = {
      title: body.title,
      excerpt: body.excerpt ?? null,
      body: body.body ?? {},
      seoTitle: body.seoTitle ?? null,
      seoDescription: body.seoDescription ?? null,
      coverUploadId: body.coverUploadId ?? null,
      coverAlt: body.coverAlt ?? null,
    };
    const explicitSlug = body.slug;
    const row =
      explicitSlug === undefined
        ? await this.insertWithGeneratedSlug(values)
        : await this.write((tx) => this.insertRow(tx, { ...values, slug: explicitSlug }));
    return this.full(row);
  }

  async update(id: string, body: UpdatePostBody): Promise<AdminPost> {
    this.assertContent(body, false);
    if (body.slug !== undefined) this.assertValid(slugErrors(body.slug));
    await this.write(async (tx) => {
      const existing = await this.posts.findForUpdate(tx, id);
      if (existing === undefined) throw postNotFound();
      if (body.slug !== undefined && body.slug !== existing.slug && existing.publishedAt !== null) {
        throw ruleViolation(
          "slug_locked",
          "The slug of a post that was published once cannot change: its address is public.",
        );
      }
      const next = {
        title: body.title ?? existing.title,
        body: body.body ?? existing.body,
      };
      if (existing.status === "published") {
        this.assertComplete(next);
      }
      await this.attachCover(tx, body.coverUploadId);
      // Drizzle leaves a column whose value is `undefined` out of the SET list: only the sent fields change.
      await this.posts.update(tx, id, body);
    });
    return this.get(id);
  }

  async publish(id: string, body: PublishPostBody): Promise<AdminPost> {
    if (body.publishedAt !== undefined && !checkPublishedAt(body.publishedAt)) {
      throw validationFailed([
        {
          path: "publishedAt",
          code: "out_of_range",
          message: "Pick an instant from 2000-01-01 to before 2200-01-01.",
        },
      ]);
    }
    await this.write(async (tx) => {
      const existing = await this.posts.findForUpdate(tx, id);
      if (existing === undefined) throw postNotFound();
      this.assertComplete(existing);
      // The rules may have tightened since the bodies were saved (ADR 0050): never publish one that no longer parses.
      this.assertValid(bodyErrors(existing.body, this.locale));
      await this.posts.update(tx, id, {
        status: "published",
        publishedAt: body.publishedAt ?? existing.publishedAt ?? new Date(),
      });
    });
    return this.get(id);
  }

  /** Back to draft; the date stays, so publishing again keeps it. */
  async unpublish(id: string): Promise<AdminPost> {
    await this.write(async (tx) => {
      const existing = await this.posts.findForUpdate(tx, id);
      if (existing === undefined) throw postNotFound();
      await this.posts.update(tx, id, { status: "draft" });
    });
    return this.get(id);
  }

  /** The cover upload stays (attached, with its file), like a deleted banner's pictures. */
  async delete(id: string): Promise<void> {
    if (!(await this.posts.delete(id))) throw postNotFound();
  }

  private offsetOf(page: number, limit: number): number {
    const offset = pageOffset(page, limit);
    if (offset === undefined) {
      throw validationFailed([
        { path: "page", code: "too_big", message: "The page lies past the 10 000th post." },
      ]);
    }
    return offset;
  }

  /** Every content error of the request at once. On create the title is required; on a PATCH only given fields count. */
  private assertContent(fields: ContentFields, isCreate: boolean): void {
    const errors: FieldError[] = [];
    if (isCreate || fields.title !== undefined) {
      errors.push(...textErrors("title", fields.title, TITLE_RULE, this.locale));
    }
    for (const [name, rule] of Object.entries(OPTIONAL_TEXT_RULES)) {
      const value = fields[name as keyof typeof OPTIONAL_TEXT_RULES];
      if (value !== undefined) errors.push(...textErrors(name, value, rule, this.locale));
    }
    if (fields.body !== undefined) errors.push(...bodyErrors(fields.body, this.locale));
    this.assertValid(errors);
  }

  private assertValid(errors: readonly FieldError[]): void {
    if (errors.length > 0) throw validationFailed(errors);
  }

  private assertComplete(post: { title: LocaleTexts; body: LocaleTexts }): void {
    const gaps = missingTranslations(post, this.locale.locales);
    if (gaps.length > 0) {
      throw ruleViolation(
        "translation_incomplete",
        "A published post needs a title and a body in every content language.",
        gaps,
      );
    }
  }

  private async attachCover(tx: BlogExecutor, uploadId: string | null | undefined): Promise<void> {
    if (uploadId === undefined || uploadId === null) return;
    await this.media.markAttachedByIds(tx, [{ path: "coverUploadId", id: uploadId }]);
  }

  private async insertRow(tx: BlogExecutor, values: NewBlogPostRow): Promise<BlogPostRow> {
    await this.attachCover(tx, values.coverUploadId);
    return this.posts.insert(tx, values);
  }

  private async insertWithGeneratedSlug(
    values: Omit<NewBlogPostRow, "slug">,
  ): Promise<BlogPostRow> {
    const title = values.title[this.locale.defaultLocale] ?? "";
    const prefix = slugLookupPrefix(title);
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.posts.transaction(async (tx) => {
          const taken =
            prefix === "" ? new Set<string>() : await this.posts.slugsStartingWith(tx, prefix);
          const generated = generateUniqueSlug(title, taken);
          if (!generated.ok) {
            throw validationFailed([
              {
                path: "slug",
                code: generated.reason,
                message: "A slug cannot be generated from this title; provide one.",
              },
            ]);
          }
          return this.insertRow(tx, { ...values, slug: generated.slug });
        });
      } catch (error) {
        if (!isUniqueViolation(error, BLOG_POST_SLUG_CONSTRAINT)) throw error;
        if (attempt >= MAX_SLUG_ATTEMPTS) throw slugTaken();
      }
    }
  }

  /** Runs one transaction; a lost slug race becomes `409 conflict` at `slug`. */
  private async write<T>(work: (tx: BlogExecutor) => Promise<T>): Promise<T> {
    try {
      return await this.posts.transaction(work);
    } catch (error) {
      throw isUniqueViolation(error, BLOG_POST_SLUG_CONSTRAINT) ? slugTaken() : error;
    }
  }

  private summary(row: BlogPostSummaryRow, now: Date): AdminPostSummary {
    return {
      id: row.id,
      slug: row.slug,
      status: row.status as BlogPostStatus,
      state: postState(row, now),
      title: row.title,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async full(row: BlogPostRow): Promise<AdminPost> {
    const [cover] =
      row.coverUploadId === null ? [] : await this.media.describeUploads([row.coverUploadId]);
    return {
      ...this.summary(row, new Date()),
      slugLocked: row.publishedAt !== null,
      excerpt: row.excerpt,
      body: row.body,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      coverUploadId: row.coverUploadId,
      cover: adminCover(cover),
      coverAlt: row.coverAlt,
    };
  }
}
