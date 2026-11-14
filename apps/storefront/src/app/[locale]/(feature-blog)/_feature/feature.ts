/**
 * The storefront slice of the optional `blog` feature (plan docs/plans/2026-11-13-blog.md, PR 4b; API `packages/features/blog`,
 * routes `docs/api/features-blog.md`). Loaded on every page through the registry, so it imports only types, storefront
 * constants, its messages and the slice's pure request module.
 */
import { isLocale, type Locale } from "@fluxkit/ui";
import { SITEMAP_REVALIDATE_SECONDS } from "../../../../lib/store-data";
import type { FeatureSitemapPage, StorefrontFeature } from "../../../../features/types";
import { GET_SITEMAP, sitemapCall, type BlogSitemap } from "./blog-api";
import { BLOG_PATH, blogPostPath } from "./blog-paths";
import en from "./messages/en.json";
import uk from "./messages/uk.json";

/**
 * The sitemap pages of the blog: the list, then every public post in the storefront locales it is written in (a post in
 * none of them is left out), each with its last change. The list's last change is the newest post's.
 */
export function blogSitemapPages(sitemap: BlogSitemap): FeatureSitemapPage[] {
  const posts = sitemap.items.flatMap((item) => {
    const locales: Locale[] = item.locales.filter(isLocale);
    return locales.length === 0
      ? []
      : [{ path: blogPostPath(item.slug), lastModified: item.updatedAt, locales }];
  });
  const newest = posts.reduce<string | undefined>(
    (latest, post) =>
      latest === undefined || Date.parse(post.lastModified) > Date.parse(latest)
        ? post.lastModified
        : latest,
    undefined,
  );
  return [{ path: BLOG_PATH, ...(newest === undefined ? {} : { lastModified: newest }) }, ...posts];
}

export const feature: StorefrontFeature = {
  name: "blog",
  navigation: [
    { placement: "header", labelKey: "features.blog.nav", path: BLOG_PATH },
    { placement: "footer", labelKey: "features.blog.nav", path: BLOG_PATH },
  ],
  sitemap: async ({ data }) => {
    const outcome = await data.read(GET_SITEMAP, sitemapCall, {
      revalidateSeconds: SITEMAP_REVALIDATE_SECONDS,
    });
    if (!outcome.ok) {
      throw new Error(
        `${GET_SITEMAP} for the sitemap answered ${String(outcome.status)} ${outcome.problem.code}.`,
      );
    }
    if (outcome.data.truncated) {
      // The API lists the newest 5 000 public posts (docs/api/features-blog.md); the older ones are missing from the sitemap
      // until a sitemap index exists.
      console.warn(
        `${GET_SITEMAP} is truncated: the sitemap lists the newest ${String(outcome.data.items.length)} posts only.`,
      );
    }
    return blogSitemapPages(outcome.data);
  },
  messages: { uk, en },
};
