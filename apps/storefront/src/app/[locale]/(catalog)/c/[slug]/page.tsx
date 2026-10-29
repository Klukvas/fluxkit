import { createTranslator } from "@fluxkit/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogRouteView } from "../../../../../components/catalog-search-view";
import { JsonLd } from "../../../../../components/json-ld";
import {
  isFilteredCatalog,
  loadCatalogList,
  resolveCatalogRoute,
} from "../../../../../lib/catalog-route.server";
import { imageHosts } from "../../../../../lib/image-hosts.server";
import { localizedHref } from "../../../../../lib/locale-path";
import { listingMetadata } from "../../../../../lib/page-metadata";
import { publicOrigin } from "../../../../../lib/public-url.server";
import { absoluteUrl, breadcrumbJsonLd, trimDescription } from "../../../../../lib/seo";
import { messagesByLocale } from "../../../../../messages";

interface CategoryProps {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * An unknown, inactive or hidden category, a malformed address and a page past the last one are all a real 404. Search off:
 * the SQL listing; search on: `GET /store/search` filtered by this category, with the SQL fallback
 * (`lib/catalog-route.server.ts`).
 */
async function resolve(props: CategoryProps) {
  const { slug } = await props.params;
  const basePath = `/c/${encodeURIComponent(slug)}`;
  const route = await resolveCatalogRoute({ ...props, categorySlug: slug, basePath });
  if (route.category === null) notFound();
  return { route, slug, basePath, category: route.category };
}

export async function generateMetadata(props: CategoryProps): Promise<Metadata> {
  const { route, basePath, category } = await resolve(props);
  const t = createTranslator(messagesByLocale[route.locale], route.locale);
  return listingMetadata({
    origin: await publicOrigin(),
    locale: route.locale,
    t,
    basePath,
    query: route.mode === "sql" ? route.query : { page: route.query.page, brand: null },
    filtered: route.mode === "search" && isFilteredCatalog(route.query),
    title: category.name,
    description:
      trimDescription(category.description) ??
      t("catalog.categoryMetaDescription", { name: category.name }),
  });
}

export default async function CategoryPage(props: CategoryProps) {
  const { route, slug, basePath, category } = await resolve(props);
  const { locale } = route;
  const t = createTranslator(messagesByLocale[locale], locale);
  const origin = await publicOrigin();
  const list = await loadCatalogList(route, slug);
  const ancestors = route.trail.slice(0, -1);
  const homeItem = { label: t("breadcrumbs.home"), href: localizedHref(locale, "/") };
  return (
    <>
      <CatalogRouteView
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
        basePath={basePath}
        subcategories={category.children}
        isCategory
        imageHosts={imageHosts()}
        list={list}
      />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: t("breadcrumbs.home"), url: absoluteUrl(origin, localizedHref(locale, "/")) },
          ...route.trail.map((node) => ({
            name: node.name,
            url: absoluteUrl(origin, localizedHref(locale, `/c/${encodeURIComponent(node.slug)}`)),
          })),
        ])}
      />
    </>
  );
}
