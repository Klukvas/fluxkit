import {
  Alert,
  Breadcrumbs,
  Container,
  EmptyState,
  MarkdownView,
  Pagination,
  textStyles,
  type BreadcrumbItem,
  type Locale,
  type Translator,
} from "@fluxkit/ui";
import Link from "next/link";
import { StoreImage } from "../../../../components/store-image";
import { focusRing, linkButton } from "../../../../components/styles";
import { formatDate } from "../../../../lib/date";
import { allowedImageUrl } from "../../../../lib/image-source";
import { localizedHref } from "../../../../lib/locale-path";
import type { BlogCover, BlogPost, BlogPostSummary } from "./blog-api";
import type { BlogListResult } from "./blog-data";
import { BLOG_PATH, blogListPath, blogPostPath } from "./blog-paths";

/**
 * The blog's views: presentational, tokens only, every text from the messages (`features.blog.*`, the shell's breadcrumbs).
 * Covers sit in a fixed 16:9 frame (no layout shift) and go through `StoreImage`: only URLs of `STOREFRONT_IMAGE_HOSTS` are
 * loaded, anything else shows the token placeholder.
 */

/** Rendered widths of a card's cover: the list is one column on phones, two from `sm`, three from `lg`. */
const CARD_COVER_SIZES = "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw";
/** The post's cover spans the reading column (`max-w-prose`, about 40rem at most). */
const POST_COVER_SIZES = "(min-width: 768px) 40rem, 100vw";

function blogCrumbs(t: Translator, locale: Locale, title?: string): BreadcrumbItem[] {
  return [
    { label: t("breadcrumbs.home"), href: localizedHref(locale, "/") },
    title === undefined
      ? { label: t("features.blog.title") }
      : { label: t("features.blog.title"), href: localizedHref(locale, BLOG_PATH) },
    ...(title === undefined ? [] : [{ label: title }]),
  ];
}

function PublishedDate({ value, locale }: { value: string; locale: Locale }) {
  return (
    <p className={textStyles.meta}>
      <time dateTime={value}>{formatDate(value, locale)}</time>
    </p>
  );
}

function Cover({
  cover,
  imageHosts,
  sizes,
  eager,
}: {
  cover: BlogCover;
  imageHosts: readonly string[];
  sizes: string;
  eager: boolean;
}) {
  return (
    <div className="aspect-video overflow-hidden bg-muted">
      <StoreImage
        src={allowedImageUrl(cover.url, imageHosts)}
        // No alt text in the admin: a decorative picture, hidden from assistive technology.
        alt={cover.alt ?? ""}
        width={cover.width}
        height={cover.height}
        sizes={sizes}
        eager={eager}
        fill
      />
    </div>
  );
}

function PostCard({
  post,
  locale,
  imageHosts,
}: {
  post: BlogPostSummary;
  locale: Locale;
  imageHosts: readonly string[];
}) {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-card border border-border bg-background">
      {post.cover === null ? null : (
        <Cover cover={post.cover} imageHosts={imageHosts} sizes={CARD_COVER_SIZES} eager={false} />
      )}
      <div className="flex flex-col gap-2 p-4">
        <h2 className={textStyles.subsectionTitle}>
          <Link
            href={localizedHref(locale, blogPostPath(post.slug))}
            className={`hover:underline hover:underline-offset-4 ${focusRing}`}
          >
            {post.title}
          </Link>
        </h2>
        <PublishedDate value={post.publishedAt} locale={locale} />
        {post.excerpt === null ? null : <p className="text-muted-foreground">{post.excerpt}</p>}
      </div>
    </article>
  );
}

export interface BlogListViewProps {
  locale: Locale;
  t: Translator;
  page: number;
  result: Exclude<BlogListResult, { kind: "beyond_last_page" }>;
  imageHosts: readonly string[];
}

/** The list: newest first, an empty state, the inline error of an outage, and the page links. */
export function BlogListView({ locale, t, page, result, imageHosts }: BlogListViewProps) {
  return (
    <Container className="flex flex-col gap-6 py-8">
      <Breadcrumbs label={t("breadcrumbs.label")} items={blogCrumbs(t, locale)} />
      <h1 className={textStyles.pageTitle}>{t("features.blog.title")}</h1>
      {result.kind === "unavailable" ? (
        <Alert variant="warning" data-blog-error="">
          {t("features.blog.error")}
        </Alert>
      ) : result.list.items.length === 0 ? (
        <EmptyState
          title={t("features.blog.empty.title")}
          description={t("features.blog.empty.description")}
          action={
            <Link href={localizedHref(locale, "/catalog")} className={linkButton}>
              {t("features.blog.empty.action")}
            </Link>
          }
          className="rounded-panel border border-border"
        />
      ) : (
        <>
          <ul
            aria-label={t("features.blog.list.label")}
            className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
          >
            {result.list.items.map((post) => (
              <li key={post.slug}>
                <PostCard post={post} locale={locale} imageHosts={imageHosts} />
              </li>
            ))}
          </ul>
          <Pagination
            label={t("features.blog.pagination.label")}
            currentPage={page}
            pageCount={result.pageCount}
            hrefForPage={(target) => localizedHref(locale, blogListPath(target))}
            previousLabel={t("features.blog.pagination.previous")}
            nextLabel={t("features.blog.pagination.next")}
            pageLabel={(target) => t("features.blog.pagination.page", { page: target })}
          />
        </>
      )}
    </Container>
  );
}

export interface BlogPostViewProps {
  locale: Locale;
  t: Translator;
  post: BlogPost;
  imageHosts: readonly string[];
}

/** One post: breadcrumbs, the title, the date, the cover (loaded first: it is above the fold), the body and a way back. */
export function BlogPostView({ locale, t, post, imageHosts }: BlogPostViewProps) {
  return (
    <Container className="flex flex-col gap-6 py-8">
      <Breadcrumbs label={t("breadcrumbs.label")} items={blogCrumbs(t, locale, post.title)} />
      <article className="flex w-full max-w-prose flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className={textStyles.pageTitle}>{post.title}</h1>
          <PublishedDate value={post.publishedAt} locale={locale} />
        </header>
        {post.cover === null ? null : (
          <div className="overflow-hidden rounded-media">
            <Cover cover={post.cover} imageHosts={imageHosts} sizes={POST_COVER_SIZES} eager />
          </div>
        )}
        <MarkdownView
          document={post.content}
          localePrefix={`/${locale}`}
          renderPathLink={({ href, className, children }) => (
            <Link href={href} className={className}>
              {children}
            </Link>
          )}
        />
        <p>
          <Link
            href={localizedHref(locale, BLOG_PATH)}
            className={`underline underline-offset-4 ${focusRing}`}
          >
            {t("features.blog.back")}
          </Link>
        </p>
      </article>
    </Container>
  );
}
