import { createTranslator, isLocale } from "@fluxkit/ui";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { SearchResultsView } from "../../../../components/search-results";
import { getShopMoney } from "../../../../lib/catalog-pages.server";
import { imageHosts } from "../../../../lib/image-hosts.server";
import { localizedHref } from "../../../../lib/locale-path";
import { searchMetadata } from "../../../../lib/page-metadata";
import { publicOrigin } from "../../../../lib/public-url.server";
import { searchData, getSearchEnabled } from "../../../../lib/search-data.server";
import { resolveSearchAddress, searchPath } from "../../../../lib/search-query";
import { messagesByLocale } from "../../../../messages";

interface SearchProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Shared by the page and `generateMetadata`. Real 404s (this route has no `loading.tsx` above it): search is off, or a
 * parameter is malformed (a shared link must show what it says, never a silently different search). A script-less form
 * submit and other non-canonical addresses redirect to the short address of the same search; a script-less submit whose
 * box is refused shows the rest of the address with the form's "Check the filters" state (review F3).
 */
async function resolve({ params, searchParams }: SearchProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  if (!(await getSearchEnabled())) notFound();
  const shop = await getShopMoney();
  const address = resolveSearchAddress(await searchParams, shop.exponent);
  if (address.kind === "malformed") notFound();
  if (address.kind === "query" && !address.canonical) {
    redirect(localizedHref(locale, searchPath(address.query)));
  }
  const formFailure = address.kind === "form_error" ? address.reason : null;
  return { locale, query: address.query, shop, formFailure };
}

export async function generateMetadata(props: SearchProps): Promise<Metadata> {
  const { locale, query } = await resolve(props);
  const t = createTranslator(messagesByLocale[locale], locale);
  return searchMetadata({ origin: await publicOrigin(), locale, t, query });
}

export default async function SearchPage(props: SearchProps) {
  const { locale, query, shop, formFailure } = await resolve(props);
  const t = createTranslator(messagesByLocale[locale], locale);
  const outcome = await searchData.search(locale, query);
  // The API says search is off (the cached config was a minute behind): the same 404.
  if (outcome.kind === "disabled") notFound();
  // A page past the last one is a real 404, like the catalog's.
  if (outcome.kind === "results" && query.page > 1 && query.page > outcome.result.pageCount) {
    notFound();
  }
  return (
    <SearchResultsView
      locale={locale}
      t={t}
      query={query}
      outcome={outcome}
      formFailure={formFailure}
      currency={shop.currency}
      exponent={shop.exponent}
      imageHosts={imageHosts()}
    />
  );
}
