import { createTranslator, isLocale } from "@fluxkit/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogView } from "../../../../components/catalog-view";
import { getListing } from "../../../../lib/catalog-pages.server";
import { parseCatalogQuery } from "../../../../lib/catalog-query";
import { imageHosts } from "../../../../lib/image-hosts.server";
import { listingMetadata } from "../../../../lib/page-metadata";
import { publicOrigin } from "../../../../lib/public-url.server";
import { localizedHref } from "../../../../lib/locale-path";
import { messagesByLocale } from "../../../../messages";

interface CatalogProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const BASE_PATH = "/catalog";

/** Shared by the page and `generateMetadata`; every "no such page" is `notFound()` (a real 404: no `loading.tsx` above). */
async function resolve({ params, searchParams }: CatalogProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const parsed = parseCatalogQuery(await searchParams);
  if (!parsed.ok) notFound();
  const listing = await getListing(locale, undefined, parsed.query.page, parsed.query.brand);
  if (listing.kind === "not_found") notFound();
  return { locale, query: parsed.query, listing };
}

export async function generateMetadata(props: CatalogProps): Promise<Metadata> {
  const { locale, query } = await resolve(props);
  const t = createTranslator(messagesByLocale[locale], locale);
  return listingMetadata({
    origin: await publicOrigin(),
    locale,
    t,
    basePath: BASE_PATH,
    query,
    title: t("catalog.title"),
    description: t("catalog.metaDescription"),
  });
}

export default async function CatalogPage(props: CatalogProps) {
  const { locale, query, listing } = await resolve(props);
  const t = createTranslator(messagesByLocale[locale], locale);
  return (
    <CatalogView
      locale={locale}
      t={t}
      heading={t("catalog.title")}
      description={null}
      breadcrumbs={[
        { label: t("breadcrumbs.home"), href: localizedHref(locale, "/") },
        { label: t("catalog.title") },
      ]}
      products={listing.products}
      page={listing.page}
      pageCount={listing.pageCount}
      exponent={listing.exponent}
      imageHosts={imageHosts()}
      basePath={BASE_PATH}
      subcategories={[]}
      brand={
        query.brand === null ? null : { slug: query.brand, name: listing.brandName ?? query.brand }
      }
      isCategory={false}
    />
  );
}
