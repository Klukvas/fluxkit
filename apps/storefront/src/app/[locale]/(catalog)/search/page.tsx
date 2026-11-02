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
import {
  MAX_SEARCH_PAGE,
  resolveSearchAddress,
  searchPath,
  setPage,
} from "../../../../lib/search-query";
import { messagesByLocale } from "../../../../messages";

interface SearchProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Shared by the page and `generateMetadata`. A real 404 (this route has no `loading.tsx` above it) when search is off. A
 * bad parameter (review SQ-04: unknown sort, bad page, malformed filter, control characters or too many words in `q`), a
 * script-less form submit and other non-canonical addresses redirect to the short, cleaned address of the same search; a
 * script-less submit whose box is refused shows the rest of the address with the form's "Check the filters" state
 * (review F3).
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
  // A page past the last one goes to the last page (review SQ-04; page 1 when nothing matches).
  if (outcome.kind === "results" && query.page > 1 && query.page > outcome.result.pageCount) {
    const last = Math.min(Math.max(outcome.result.pageCount, 1), MAX_SEARCH_PAGE);
    redirect(localizedHref(locale, searchPath(setPage(query, last))));
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
