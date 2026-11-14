import { Inject, Injectable, Logger } from "@nestjs/common";
import { LOCALE_CONFIG, MEDIA_PORT, type LocaleConfig } from "@fluxkit/api-kit";
import {
  parseMarkdown,
  validateSlug,
  type MediaPort,
  type MediaUploadDescription,
} from "@fluxkit/core";
import { BlogRepository, type BlogPostSummaryRow } from "./blog.repository.js";
import { postNotFound, validationFailed } from "./problems.js";
import {
  ownText,
  type Paged,
  type StoreCover,
  type StorePost,
  type StorePostSummary,
  type StoreSitemap,
} from "./responses.js";
import { BLOG_LIMITS, pageOffset } from "./rules.js";
import type { StoreListQuery } from "./schemas.js";

/**
 * The public side of the blog (plan sections 6 and 8): public posts only (published, date reached, written in the requested
 * locale), public fields only. The database keeps Markdown sources, never an AST: a post's body is parsed again on every
 * read with the current rules and limits, and a body that no longer parses is never served (`404`, logged with the post id
 * and the error code).
 */
@Injectable()
export class StoreBlogService {
  private readonly logger = new Logger(StoreBlogService.name);

  constructor(
    private readonly posts: BlogRepository,
    @Inject(LOCALE_CONFIG) private readonly locale: LocaleConfig,
    @Inject(MEDIA_PORT) private readonly media: MediaPort,
  ) {}

  async list(query: StoreListQuery): Promise<Paged<StorePostSummary>> {
    const locale = this.resolveLocale(query.locale);
    const offset = pageOffset(query.page, query.limit);
    if (offset === undefined) {
      throw validationFailed([
        { path: "page", code: "too_big", message: "The page lies past the 10 000th post." },
      ]);
    }
    const { rows, total } = await this.posts.publicPage(locale, new Date(), {
      limit: query.limit,
      offset,
    });
    const covers = await this.describeCovers(rows);
    return {
      items: rows.map((row) => this.summary(row, locale, covers)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async get(slug: string, requestedLocale: string | undefined): Promise<StorePost> {
    const locale = this.resolveLocale(requestedLocale);
    // A string that is not a slug cannot name a post: the same 404 as an unknown one, without a query.
    if (!validateSlug(slug).ok) throw postNotFound();
    const row = await this.posts.publicPost(slug, locale, new Date());
    if (row === undefined) throw postNotFound();
    const parsed = parseMarkdown(row.body[locale] ?? "", { locales: this.locale.locales });
    if (!parsed.ok) {
      this.logger.warn(
        `Blog post ${row.id} is not served in ${locale}: its body no longer parses (${parsed.error.code}, line ${String(parsed.error.line)}).`,
      );
      throw postNotFound();
    }
    const covers = await this.describeCovers([row]);
    return {
      ...this.summary(row, locale, covers),
      seoTitle: ownText(row.seoTitle, locale),
      seoDescription: ownText(row.seoDescription, locale),
      content: parsed.document,
      locales: this.locale.locales.filter(
        (candidate) =>
          ownText(row.title, candidate) !== null && ownText(row.body, candidate) !== null,
      ),
    };
  }

  /** The newest public posts for the sitemap, at most 5 000; beyond the cap `truncated` and a warning with the count. */
  async sitemap(): Promise<StoreSitemap> {
    const now = new Date();
    const rows = await this.posts.publicSitemap(
      now,
      this.locale.locales,
      BLOG_LIMITS.sitemapMaxItems + 1,
    );
    const truncated = rows.length > BLOG_LIMITS.sitemapMaxItems;
    if (truncated) {
      const total = await this.posts.publicCount(now);
      this.logger.warn(
        `The blog sitemap lists the newest ${String(BLOG_LIMITS.sitemapMaxItems)} of ${String(total)} public posts.`,
      );
    }
    return {
      items: rows
        .slice(0, BLOG_LIMITS.sitemapMaxItems)
        .filter((row) => row.locales.length > 0)
        .map((row) => ({
          slug: row.slug,
          updatedAt: row.updatedAt.toISOString(),
          locales: row.locales,
        })),
      truncated,
    };
  }

  private resolveLocale(requested: string | undefined): string {
    const locale = requested ?? this.locale.defaultLocale;
    if (!this.locale.locales.includes(locale)) {
      throw validationFailed([
        {
          path: "locale",
          code: "invalid_value",
          message: `Must be one of: ${this.locale.locales.join(", ")}.`,
        },
      ]);
    }
    return locale;
  }

  private async describeCovers(
    rows: readonly Pick<BlogPostSummaryRow, "coverUploadId">[],
  ): Promise<ReadonlyMap<string, MediaUploadDescription>> {
    const ids = [
      ...new Set(rows.flatMap((row) => (row.coverUploadId === null ? [] : [row.coverUploadId]))),
    ];
    if (ids.length === 0) return new Map();
    const described = await this.media.describeUploads(ids);
    return new Map(described.map((upload) => [upload.id, upload]));
  }

  private summary(
    row: BlogPostSummaryRow,
    locale: string,
    covers: ReadonlyMap<string, MediaUploadDescription>,
  ): StorePostSummary {
    const upload = row.coverUploadId === null ? undefined : covers.get(row.coverUploadId);
    const cover: StoreCover | null =
      upload === undefined
        ? null
        : {
            url: upload.url,
            width: upload.width,
            height: upload.height,
            alt: ownText(row.coverAlt, locale),
          };
    if (row.publishedAt === null) {
      // The public predicate selects dated rows only; a row without a date here is a bug, not data to degrade.
      throw new Error(`Blog post ${row.id} is public but has no publish date.`);
    }
    return {
      slug: row.slug,
      title: ownText(row.title, locale) ?? "",
      excerpt: ownText(row.excerpt, locale),
      publishedAt: row.publishedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      cover,
    };
  }
}
