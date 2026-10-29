import { createTranslator } from "@fluxkit/ui";
import type { Metadata } from "next";
import { CatalogRouteView } from "../../../../components/catalog-search-view";
import {
  isFilteredCatalog,
  loadCatalogList,
  resolveCatalogRoute,
} from "../../../../lib/catalog-route.server";
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

/**
 * Search off: the SQL listing (`?brand=&page=`). Search on: the list, facets and sort of `GET /store/search` with the
 * results page's URL state, falling back to the SQL listing with a notice when search cannot answer
 * (`lib/catalog-route.server.ts`). Every "no such page" is a real 404.
 */
function resolve(props: CatalogProps) {
  return resolveCatalogRoute({ ...props, basePath: BASE_PATH });
}

export async function generateMetadata(props: CatalogProps): Promise<Metadata> {
  const route = await resolve(props);
  const t = createTranslator(messagesByLocale[route.locale], route.locale);
  return listingMetadata({
    origin: await publicOrigin(),
    locale: route.locale,
    t,
    basePath: BASE_PATH,
    query: route.mode === "sql" ? route.query : { page: route.query.page, brand: null },
    filtered: route.mode === "search" && isFilteredCatalog(route.query),
    title: t("catalog.title"),
    description: t("catalog.metaDescription"),
  });
}

export default async function CatalogPage(props: CatalogProps) {
  const route = await resolve(props);
  const { locale } = route;
  const t = createTranslator(messagesByLocale[locale], locale);
  const list = await loadCatalogList(route, undefined);
  return (
    <CatalogRouteView
      locale={locale}
      t={t}
      heading={t("catalog.title")}
      description={null}
      breadcrumbs={[
        { label: t("breadcrumbs.home"), href: localizedHref(locale, "/") },
        { label: t("catalog.title") },
      ]}
      basePath={BASE_PATH}
      subcategories={[]}
      isCategory={false}
      imageHosts={imageHosts()}
      list={list}
    />
  );
}
