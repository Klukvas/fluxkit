import { createTranslator, isLocale } from "@fluxkit/ui";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { JsonLd } from "../../../../components/json-ld";
import { brand } from "../../../../config/brand";
import { requireFeature } from "../../../../features/runtime.server";
import { imageHosts } from "../../../../lib/image-hosts.server";
import { localizedHref } from "../../../../lib/locale-path";
import { publicOrigin } from "../../../../lib/public-url.server";
import { messagesByLocale } from "../../../../messages";
import { getBlogList } from "../_feature/blog-data.server";
import { blogListPath, normalizeBlogPage } from "../_feature/blog-paths";
import { blogBreadcrumbJsonLd, blogListMetadata } from "../_feature/blog-seo";
import { BlogListView } from "../_feature/views";

interface BlogListProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** The locale and the page an address asks for; `notFound()` for a locale the storefront does not have. */
async function resolve({ params, searchParams }: BlogListProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return { locale, ...normalizeBlogPage(await searchParams) };
}

export async function generateMetadata(props: BlogListProps): Promise<Metadata> {
  await requireFeature("blog");
  const { locale, page } = await resolve(props);
  return blogListMetadata({
    origin: await publicOrigin(),
    locale,
    t: createTranslator(messagesByLocale[locale], locale),
    page,
    ogImage: brand.ogImage,
  });
}

/**
 * `/{locale}/blog?page=N`: the public posts, newest first. A bad `page` redirects to the repaired address and a page past the
 * last one to the last page, like the catalog. An outage shows the inline error, never a broken page.
 */
export default async function BlogListPage(props: BlogListProps) {
  await requireFeature("blog");
  const { locale, page, canonical } = await resolve(props);
  if (!canonical) redirect(localizedHref(locale, blogListPath(page)));
  const result = await getBlogList(locale, page);
  if (result.kind === "beyond_last_page") {
    redirect(localizedHref(locale, blogListPath(result.lastPage)));
  }
  const t = createTranslator(messagesByLocale[locale], locale);
  return (
    <>
      <BlogListView locale={locale} t={t} page={page} result={result} imageHosts={imageHosts()} />
      <JsonLd data={blogBreadcrumbJsonLd({ origin: await publicOrigin(), locale, t })} />
    </>
  );
}
