import { Inject, Injectable } from "@nestjs/common";
import { FEATURE_DATABASE } from "@fluxkit/api-kit";
import { and, count, eq, gt, like, lte, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { blogPost, type BlogPostRow, type NewBlogPostRow } from "./schema.js";
import type { BlogPostState } from "./rules.js";

/** The API's database or a transaction on it: both run the same queries. */
export type BlogExecutor = Pick<NodePgDatabase, "select" | "insert" | "update" | "delete">;

/** The columns of a list row: everything but the bodies, which a list never needs. */
const summaryColumns = {
  id: blogPost.id,
  slug: blogPost.slug,
  status: blogPost.status,
  publishedAt: blogPost.publishedAt,
  title: blogPost.title,
  excerpt: blogPost.excerpt,
  coverUploadId: blogPost.coverUploadId,
  coverAlt: blogPost.coverAlt,
  createdAt: blogPost.createdAt,
  updatedAt: blogPost.updatedAt,
};

export type BlogPostSummaryRow = Pick<BlogPostRow, keyof typeof summaryColumns>;

/** The index order of `blog_post_public_idx` and `blog_post_updated_idx` (`DESC NULLS LAST`), so both lists use them. */
const newestPublishedFirst = [
  sql`${blogPost.publishedAt} desc nulls last`,
  sql`${blogPost.id} desc nulls last`,
];
const newestUpdatedFirst = [
  sql`${blogPost.updatedAt} desc nulls last`,
  sql`${blogPost.id} desc nulls last`,
];

/** Public now: published and its date reached (the SQL twin of `isPublicPost`). */
function publicAt(now: Date): SQL {
  return and(eq(blogPost.status, "published"), lte(blogPost.publishedAt, now)) as SQL;
}

/** Has a non-blank title and body in `locale`: a public post is served only in the locales it is written in. */
function writtenIn(locale: string): SQL {
  return sql`coalesce(${blogPost.title} ->> ${locale}, '') ~ '[^[:space:]]' and coalesce(${blogPost.body} ->> ${locale}, '') ~ '[^[:space:]]'`;
}

function stateFilter(state: BlogPostState | undefined, now: Date): SQL | undefined {
  switch (state) {
    case undefined:
      return undefined;
    case "draft":
      return eq(blogPost.status, "draft");
    case "scheduled":
      return and(eq(blogPost.status, "published"), gt(blogPost.publishedAt, now));
    case "published":
      return publicAt(now);
  }
}

export interface PageRequest {
  readonly limit: number;
  readonly offset: number;
}

/** Data access of `blog_post` (the feature's own table only; uploads go through `MEDIA_PORT`). */
@Injectable()
export class BlogRepository {
  constructor(@Inject(FEATURE_DATABASE) private readonly db: NodePgDatabase) {}

  /** One transaction on the API's pool. */
  transaction<T>(work: (tx: BlogExecutor) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  async findById(id: string, executor: BlogExecutor = this.db): Promise<BlogPostRow | undefined> {
    const [row] = await executor.select().from(blogPost).where(eq(blogPost.id, id));
    return row;
  }

  /** The row, locked until the transaction ends: a PATCH and a publish of one post never interleave. */
  async findForUpdate(tx: BlogExecutor, id: string): Promise<BlogPostRow | undefined> {
    const [row] = await tx.select().from(blogPost).where(eq(blogPost.id, id)).for("update");
    return row;
  }

  async insert(tx: BlogExecutor, values: NewBlogPostRow): Promise<BlogPostRow> {
    const [row] = await tx.insert(blogPost).values(values).returning();
    if (row === undefined) {
      throw new Error("The database returned no row for an insert that must return one.");
    }
    return row;
  }

  async update(tx: BlogExecutor, id: string, values: Partial<NewBlogPostRow>): Promise<void> {
    await tx
      .update(blogPost)
      .set({ ...values, updatedAt: sql`now()` })
      .where(eq(blogPost.id, id));
  }

  /** True when a row was deleted. */
  async delete(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(blogPost)
      .where(eq(blogPost.id, id))
      .returning({ id: blogPost.id });
    return deleted.length > 0;
  }

  /** Every slug that starts with `prefix` (a `slugLookupPrefix`: letters, digits and hyphens only, no LIKE wildcard). */
  async slugsStartingWith(tx: BlogExecutor, prefix: string): Promise<Set<string>> {
    const rows = await tx
      .select({ slug: blogPost.slug })
      .from(blogPost)
      .where(like(blogPost.slug, `${prefix}%`));
    return new Set(rows.map((row) => row.slug));
  }

  /** Admin list: every post (or those in `state`), the most recently updated first. */
  async adminPage(
    state: BlogPostState | undefined,
    now: Date,
    page: PageRequest,
  ): Promise<{ rows: BlogPostSummaryRow[]; total: number }> {
    const where = stateFilter(state, now);
    const [rows, totals] = await Promise.all([
      this.db
        .select(summaryColumns)
        .from(blogPost)
        .where(where)
        .orderBy(...newestUpdatedFirst)
        .limit(page.limit)
        .offset(page.offset),
      this.db.select({ total: count() }).from(blogPost).where(where),
    ]);
    return { rows, total: totals[0]?.total ?? 0 };
  }

  /** Store list: the public posts written in `locale`, the newest first. */
  async publicPage(
    locale: string,
    now: Date,
    page: PageRequest,
  ): Promise<{ rows: BlogPostSummaryRow[]; total: number }> {
    const where = and(publicAt(now), writtenIn(locale));
    const [rows, totals] = await Promise.all([
      this.db
        .select(summaryColumns)
        .from(blogPost)
        .where(where)
        .orderBy(...newestPublishedFirst)
        .limit(page.limit)
        .offset(page.offset),
      this.db.select({ total: count() }).from(blogPost).where(where),
    ]);
    return { rows, total: totals[0]?.total ?? 0 };
  }

  /** One public post by slug, written in `locale`; `undefined` for a draft, a scheduled or an unknown one. */
  async publicPost(slug: string, locale: string, now: Date): Promise<BlogPostRow | undefined> {
    const [row] = await this.db
      .select()
      .from(blogPost)
      .where(and(eq(blogPost.slug, slug), publicAt(now), writtenIn(locale)));
    return row;
  }

  /**
   * The public posts for the sitemap, the newest first, at most `limit`, each with the locales (of `locales`, in that order)
   * it is written in. The bodies stay in the database: only the check runs there.
   */
  async publicSitemap(
    now: Date,
    locales: readonly string[],
    limit: number,
  ): Promise<{ slug: string; updatedAt: Date; locales: string[] }[]> {
    const written = sql<string[]>`array(
      select l.locale from unnest(${sql.param([...locales])}::text[]) with ordinality as l(locale, position)
       where coalesce(${blogPost.title} ->> l.locale, '') ~ '[^[:space:]]'
         and coalesce(${blogPost.body} ->> l.locale, '') ~ '[^[:space:]]'
       order by l.position)`;
    return this.db
      .select({ slug: blogPost.slug, updatedAt: blogPost.updatedAt, locales: written })
      .from(blogPost)
      .where(publicAt(now))
      .orderBy(...newestPublishedFirst)
      .limit(limit);
  }

  async publicCount(now: Date): Promise<number> {
    const [row] = await this.db.select({ total: count() }).from(blogPost).where(publicAt(now));
    return row?.total ?? 0;
  }
}
