/**
 * Metadata and JSON-LD of the blog pages, in the style of `lib/page-metadata.ts` and `lib/seo.ts`. Pure: the page passes the
 * public origin, the translator, the data and the brand pictures (`config/brand.ts`; tests pass their own). Every canonical and
 * hreflang URL is absolute. A post's alternates name only the locales it is written in (owner's answer 6: a post is served in
 * a locale only when it has a title and a body there). The shop is the author and the publisher (owner's answer 8 (a): no
 * personal author, no personal data in posts).
 */
import { defaultLocale, locales, type Locale, type Translator } from "@fluxkit/ui";
import type { Metadata } from "next";
import { brandOpenGraphImages, type BrandLogo, type BrandPicture } from "../../../../lib/brand";
import {
  absoluteUrl,
  breadcrumbJsonLd,
  languageAlternates,
  socialImageUrl,
  trimDescription,
} from "../../../../lib/seo";
import { localizedHref } from "../../../../lib/locale-path";
import type { BlogPost } from "./blog-api";
import { BLOG_PATH, blogListPath, blogPostPath } from "./blog-paths";
import { documentText, wordCount } from "./blog-text";

/** schema.org advises a `headline` of at most 110 characters. */
export const HEADLINE_MAX_LENGTH = 110;

function pageTitle(t: Translator, title: string): string {
  return t("seo.pageTitle", { title, site: t("site.name") });
}

function brandImages(origin: string, t: Translator, ogImage: BrandPicture | null) {
  const images = brandOpenGraphImages(origin, t, ogImage);
  return images === undefined ? {} : { images };
}

export interface BlogListMetadataInput {
  origin: string;
  locale: Locale;
  t: Translator;
  page: number;
  /** `config/brand.ts` `ogImage`. */
  ogImage: BrandPicture | null;
  /**
   * The list could not be read (the inline error shows): `noindex, follow`, so a crawler never indexes the error state. The
   * catalog has no such state (an outage there is the route's error view), so this is the blog's own rule.
   */
  unavailable?: boolean;
}

/**
 * The list: title and description from the messages, its own canonical (`?page=N` from page 2), hreflang for every locale,
 * `noindex, follow` from page 2 (the posts are reachable from page 1 and the sitemap, like `listingRobots`) and while the list
 * is unavailable.
 */
export function blogListMetadata(input: BlogListMetadataInput): Metadata {
  const { t, page } = input;
  const heading =
    page > 1
      ? `${t("features.blog.title")} (${t("features.blog.pagination.page", { page })})`
      : t("features.blog.title");
  const title = pageTitle(t, heading);
  const description = t("features.blog.metaDescription");
  const alternates = languageAlternates({
    origin: input.origin,
    locale: input.locale,
    locales,
    defaultLocale,
    path: blogListPath(page),
  });
  return {
    title,
    description,
    alternates,
    ...(page > 1 || input.unavailable === true ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      title,
      description,
      url: alternates.canonical,
      siteName: t("site.name"),
      type: "website",
      ...brandImages(input.origin, t, input.ogImage),
    },
  };
}

/** The storefront locales a post is written in, in the storefront's order; the page's own locale is always among them. */
export function postLocales(post: Pick<BlogPost, "locales">, locale: Locale): Locale[] {
  return locales.filter((candidate) => candidate === locale || post.locales.includes(candidate));
}

/** Canonical and hreflang of a post: its locales only, `x-default` the default locale when the post has it, else its first. */
export function postAlternates(origin: string, locale: Locale, post: BlogPost) {
  const written = postLocales(post, locale);
  return languageAlternates({
    origin,
    locale,
    locales: written,
    defaultLocale: written.includes(defaultLocale) ? defaultLocale : (written[0] ?? locale),
    path: blogPostPath(post.slug),
  });
}

/**
 * The post's last change for crawlers: `updatedAt`, but never before `publishedAt`. The API stamps `updatedAt` before it sets the
 * publish date of a first publish (milliseconds earlier), and a post scheduled ahead was last saved before it went live.
 */
export function postModifiedTime(post: Pick<BlogPost, "publishedAt" | "updatedAt">): string {
  return Date.parse(post.updatedAt) < Date.parse(post.publishedAt)
    ? post.publishedAt
    : post.updatedAt;
}

/** A text that says something, else `null`: an empty or blank text falls through the fallback chains below. */
function filled(text: string | null): string | null {
  return text === null || text.trim() === "" ? null : text;
}

/** `seoDescription`, else the excerpt, else the start of the body: plain text of at most 160 characters. */
export function postDescription(post: BlogPost): string | undefined {
  return trimDescription(
    filled(post.seoDescription) ?? filled(post.excerpt) ?? documentText(post.content),
  );
}

export interface BlogPostMetadataInput {
  origin: string;
  locale: Locale;
  t: Translator;
  post: BlogPost;
  ogImage: BrandPicture | null;
}

/**
 * A post: title `seoTitle ?? title`, the description above, the canonical and the alternates of its locales, Open Graph
 * `article` with its times and the cover (else the brand's picture).
 */
export function blogPostMetadata(input: BlogPostMetadataInput): Metadata {
  const { t, post } = input;
  const title = pageTitle(t, filled(post.seoTitle) ?? post.title);
  const description = postDescription(post);
  const alternates = postAlternates(input.origin, input.locale, post);
  const coverUrl = socialImageUrl(post.cover?.url);
  return {
    title,
    ...(description === undefined ? {} : { description }),
    alternates,
    openGraph: {
      title,
      ...(description === undefined ? {} : { description }),
      url: alternates.canonical,
      siteName: t("site.name"),
      type: "article",
      publishedTime: post.publishedAt,
      modifiedTime: postModifiedTime(post),
      ...(coverUrl === null || post.cover === null
        ? brandImages(input.origin, t, input.ogImage)
        : {
            images: [
              {
                url: coverUrl,
                width: post.cover.width,
                height: post.cover.height,
                alt: post.cover.alt ?? post.title,
              },
            ],
          }),
    },
  };
}

/** The shop as a schema.org `Organization`: its name, its address and the header logo when the brand has a picture. */
export function shopOrganizationJsonLd(input: {
  origin: string;
  name: string;
  logo: BrandLogo;
}): object {
  return {
    "@type": "Organization",
    name: input.name,
    url: absoluteUrl(input.origin, "/"),
    ...(input.logo.kind === "image"
      ? {
          logo: {
            "@type": "ImageObject",
            url: absoluteUrl(input.origin, input.logo.light.src),
            width: input.logo.light.width,
            height: input.logo.light.height,
          },
        }
      : {}),
  };
}

export interface BlogPostingJsonLdInput {
  origin: string;
  locale: Locale;
  t: Translator;
  post: BlogPost;
  /** `config/brand.ts` `logo`. */
  logo: BrandLogo;
  /** `config/brand.ts` `ogImage`: the `image` of a post without a cover, as in its Open Graph. */
  ogImage: BrandPicture | null;
}

/**
 * schema.org `BlogPosting` of a post; the shop (`site.name`) is the author and the publisher. `image`: the cover, else the brand's
 * social picture, else none.
 */
export function blogPostingJsonLd(input: BlogPostingJsonLdInput): object {
  const { post } = input;
  const url = postAlternates(input.origin, input.locale, post).canonical;
  const description = postDescription(post);
  const cover = socialImageUrl(post.cover?.url);
  const image =
    cover ?? (input.ogImage === null ? null : absoluteUrl(input.origin, input.ogImage.src));
  const shop = shopOrganizationJsonLd({
    origin: input.origin,
    name: input.t("site.name"),
    logo: input.logo,
  });
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: trimDescription(post.title, HEADLINE_MAX_LENGTH) ?? post.title,
    ...(description === undefined ? {} : { description }),
    ...(image === null ? {} : { image: [image] }),
    datePublished: post.publishedAt,
    dateModified: postModifiedTime(post),
    inLanguage: input.locale,
    wordCount: wordCount(documentText(post.content)),
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    // The author is the shop by name and address; its logo belongs to the publisher (schema.org's publisher `logo`).
    author: {
      "@type": "Organization",
      name: input.t("site.name"),
      url: absoluteUrl(input.origin, "/"),
    },
    publisher: shop,
  };
}

/** `BreadcrumbList` of the list (Home, Blog) or of a post (Home, Blog, its title). */
export function blogBreadcrumbJsonLd(input: {
  origin: string;
  locale: Locale;
  t: Translator;
  post?: Pick<BlogPost, "slug" | "title">;
}): object {
  const { origin, locale, t, post } = input;
  return breadcrumbJsonLd([
    { name: t("breadcrumbs.home"), url: absoluteUrl(origin, localizedHref(locale, "/")) },
    { name: t("features.blog.title"), url: absoluteUrl(origin, localizedHref(locale, BLOG_PATH)) },
    ...(post === undefined
      ? []
      : [
          {
            name: post.title,
            url: absoluteUrl(origin, localizedHref(locale, blogPostPath(post.slug))),
          },
        ]),
  ]);
}
