import { createTranslator, isLocale } from "@fluxkit/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogView } from "../../../../../components/catalog-view";
import { JsonLd } from "../../../../../components/json-ld";
import { getListing } from "../../../../../lib/catalog-pages.server";
import { parseCatalogQuery } from "../../../../../lib/catalog-query";
import { IMAGE_HOSTS } from "../../../../../lib/image-hosts";
import { localizedHref } from "../../../../../lib/locale-path";
import { listingMetadata } from "../../../../../lib/page-metadata";
import { publicOrigin } from "../../../../../lib/public-url.server";
import { absoluteUrl, breadcrumbJsonLd, trimDescription } from "../../../../../lib/seo";
import { messagesByLocale } from "../../../../../messages";

interface CategoryProps {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** An unknown, inactive or hidden category, a malformed page and a page past the last one are all a real 404. */
async function resolve({ params, searchParams }: CategoryProps) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const parsed = parseCatalogQuery(await searchParams);
  if (!parsed.ok) notFound();
  const listing = await getListing(locale, slug, parsed.query.page, parsed.query.brand);
  if (listing.kind === "not_found" || listing.category === null) notFound();
  return { locale, slug, query: parsed.query, listing, category: listing.category };
}

export async function generateMetadata(props: CategoryProps): Promise<Metadata> {
  const { locale, slug, query, category } = await resolve(props);
  const t = createTranslator(messagesByLocale[locale], locale);
  return listingMetadata({
    origin: await publicOrigin(),
    locale,
    t,
    basePath: `/c/${encodeURIComponent(slug)}`,
    query,
    title: category.name,
    description:
      trimDescription(category.description) ??
      t("catalog.categoryMetaDescription", { name: category.name }),
  });
}

export default async function CategoryPage(props: CategoryProps) {
  const { locale, slug, query, listing, category } = await resolve(props);
  const t = createTranslator(messagesByLocale[locale], locale);
  const origin = await publicOrigin();
  const ancestors = listing.trail.slice(0, -1);
  const homeItem = { label: t("breadcrumbs.home"), href: localizedHref(locale, "/") };
  return (
    <>
      <CatalogView
        locale={locale}
        t={t}
        heading={category.name}
        description={category.description}
        breadcrumbs={[
          homeItem,
          ...ancestors.map((node) => ({
            label: node.name,
            href: localizedHref(locale, `/c/${encodeURIComponent(node.slug)}`),
          })),
          { label: category.name },
        ]}
        products={listing.products}
        page={listing.page}
        pageCount={listing.pageCount}
        exponent={listing.exponent}
        imageHosts={IMAGE_HOSTS}
        basePath={`/c/${encodeURIComponent(slug)}`}
        subcategories={category.children}
        brand={
          query.brand === null
            ? null
            : { slug: query.brand, name: listing.brandName ?? query.brand }
        }
        isCategory
      />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: t("breadcrumbs.home"), url: absoluteUrl(origin, localizedHref(locale, "/")) },
          ...listing.trail.map((node) => ({
            name: node.name,
            url: absoluteUrl(origin, localizedHref(locale, `/c/${encodeURIComponent(node.slug)}`)),
          })),
        ])}
      />
    </>
  );
}
