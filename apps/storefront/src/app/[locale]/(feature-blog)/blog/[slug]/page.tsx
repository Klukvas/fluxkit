import { createTranslator, isLocale } from "@fluxkit/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "../../../../../components/json-ld";
import { brand } from "../../../../../config/brand";
import { requireFeature } from "../../../../../features/runtime.server";
import { imageHosts } from "../../../../../lib/image-hosts.server";
import { publicOrigin } from "../../../../../lib/public-url.server";
import { messagesByLocale } from "../../../../../messages";
import { getBlogPost } from "../../_feature/blog-data.server";
import { isPostSlug } from "../../_feature/blog-paths";
import { blogBreadcrumbJsonLd, blogPostMetadata, blogPostingJsonLd } from "../../_feature/blog-seo";
import { BlogPostView } from "../../_feature/views";

interface BlogPostProps {
  params: Promise<{ locale: string; slug: string }>;
}

/**
 * A REAL 404 for a slug that names no public post in this locale (unknown, draft, scheduled, not written in it): `notFound()`
 * runs before anything streams, and no `loading.tsx` sits above a slice. A string that is not a slug is not asked for.
 */
async function resolve({ params }: BlogPostProps) {
  const { locale, slug } = await params;
  if (!isLocale(locale) || !isPostSlug(slug)) notFound();
  const post = await getBlogPost(locale, slug);
  if (post === null) notFound();
  return { locale, post };
}

export async function generateMetadata(props: BlogPostProps): Promise<Metadata> {
  await requireFeature("blog");
  const { locale, post } = await resolve(props);
  return blogPostMetadata({
    origin: await publicOrigin(),
    locale,
    t: createTranslator(messagesByLocale[locale], locale),
    post,
    ogImage: brand.ogImage,
  });
}

export default async function BlogPostPage(props: BlogPostProps) {
  await requireFeature("blog");
  const { locale, post } = await resolve(props);
  const t = createTranslator(messagesByLocale[locale], locale);
  const origin = await publicOrigin();
  return (
    <>
      <BlogPostView locale={locale} t={t} post={post} imageHosts={imageHosts()} />
      <JsonLd
        data={blogPostingJsonLd({
          origin,
          locale,
          t,
          post,
          logo: brand.logo,
          ogImage: brand.ogImage,
        })}
      />
      <JsonLd data={blogBreadcrumbJsonLd({ origin, locale, t, post })} />
    </>
  );
}
