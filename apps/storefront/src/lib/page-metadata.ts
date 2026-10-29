import type { ProductDetail } from "@fluxkit/api-client";
import { defaultLocale, locales, type Translator } from "@fluxkit/ui";
import type { Metadata } from "next";
import { catalogPath, type CatalogQuery } from "./catalog-query";
import { searchPath, type SearchQuery } from "./search-query";
import {
  absoluteUrl,
  languageAlternates,
  listingRobots,
  socialImageUrl,
  trimDescription,
} from "./seo";

/**
 * `generateMetadata` results, built from data (plan, "SEO"). Pure: the route passes the public origin, the translator and
 * the loaded data. Every canonical and hreflang URL is absolute, built from `STOREFRONT_PUBLIC_URL`.
 */

function alternatesFor(origin: string, locale: string, path: string) {
  return languageAlternates({ origin, locale, locales, defaultLocale, path });
}

function pageTitle(t: Translator, title: string): string {
  return t("seo.pageTitle", { title, site: t("site.name") });
}

export function homeMetadata(input: { origin: string; locale: string }): Metadata {
  return { alternates: alternatesFor(input.origin, input.locale, "") };
}

export interface ListingMetadataInput {
  origin: string;
  locale: string;
  t: Translator;
  /** Locale-less path of the list: `/catalog` or `/c/<slug>`. */
  basePath: string;
  query: CatalogQuery;
  title: string;
  description: string | undefined;
}

/**
 * Catalog and category lists. The canonical never carries `brand`: a filtered view points at the unfiltered list, keeps the
 * page of a later page, and is `noindex, follow` together with every page after the first (`listingRobots`).
 */
export function listingMetadata(input: ListingMetadataInput): Metadata {
  const { t, query } = input;
  const heading =
    query.page > 1
      ? `${input.title} (${t("catalog.pagination.page", { page: query.page })})`
      : input.title;
  const title = pageTitle(t, heading);
  const alternates = alternatesFor(
    input.origin,
    input.locale,
    catalogPath(input.basePath, { page: query.page }),
  );
  const robots = listingRobots(query);
  return {
    title,
    ...(input.description === undefined ? {} : { description: input.description }),
    alternates,
    ...(robots === undefined ? {} : { robots }),
    openGraph: {
      title,
      ...(input.description === undefined ? {} : { description: input.description }),
      url: alternates.canonical,
      siteName: t("site.name"),
      type: "website",
    },
  };
}

/**
 * The results page: `noindex, follow` in every state (a result is a view of the catalog, not a page to rank; the products
 * are reachable from the catalog, the category pages and the sitemap). The canonical is the page for the words alone (no
 * filter, sort or page), in the page's own locale and with no hreflang: the same words in another language are another
 * search. The words are in the title as plain text; Next escapes them.
 */
export function searchMetadata(input: {
  origin: string;
  locale: string;
  t: Translator;
  query: SearchQuery;
}): Metadata {
  const { t, query } = input;
  const heading = query.q === "" ? t("search.title") : `${t("search.title")}: ${query.q}`;
  const wordsOnly: SearchQuery = { q: query.q, facets: [], price: null, sort: null, page: 1 };
  return {
    title: pageTitle(t, heading),
    description: t("search.metaDescription"),
    alternates: {
      canonical: absoluteUrl(input.origin, `/${input.locale}${searchPath(wordsOnly)}`),
    },
    robots: { index: false, follow: true },
  };
}

export function productMetadata(input: {
  origin: string;
  locale: string;
  t: Translator;
  product: ProductDetail;
}): Metadata {
  const { t, product } = input;
  const title = pageTitle(t, product.title);
  const description = trimDescription(product.description) ?? product.title;
  const alternates = alternatesFor(
    input.origin,
    input.locale,
    `/p/${encodeURIComponent(product.slug)}`,
  );
  const imageUrl = socialImageUrl(product.media[0]?.url);
  return {
    title,
    description,
    alternates,
    openGraph: {
      title,
      description,
      url: alternates.canonical,
      siteName: t("site.name"),
      type: "website",
      ...(imageUrl === null
        ? {}
        : { images: [{ url: imageUrl, alt: product.media[0]?.alt ?? product.title }] }),
    },
  };
}

/**
 * Metadata of a legal page (privacy plan step 10): a title and the page's own canonical, no robots opinion. The text is
 * the shop's to supply; master ships placeholders (`config/legal.ts`).
 */
export function legalMetadata(input: {
  origin: string;
  locale: string;
  t: Translator;
  titleKey: string;
  slug: string;
}): Metadata {
  const title = pageTitle(input.t, input.t(input.titleKey));
  const alternates = alternatesFor(input.origin, input.locale, `/legal/${input.slug}`);
  return { title, alternates };
}

/**
 * Metadata of a page that belongs to one shopper (cart, checkout, account): a title and `noindex, nofollow`. No canonical
 * and no alternates: the page is not a search result in any language. `robots.txt` keeps crawlers out as well
 * (`lib/robots.ts`); this tag covers a crawler that follows a link anyway. `noReferrer` adds the referrer meta tag.
 */
export function privateMetadata(
  t: Translator,
  titleKey: string,
  options: { noReferrer?: boolean } = {},
): Metadata {
  return {
    title: pageTitle(t, t(titleKey)),
    robots: { index: false, follow: false },
    // The pages of emailed links (`<meta name="referrer" content="no-referrer">`): the header says the same, this is the
    // second line for a browser or proxy that drops it. The token is in the fragment, which a Referer never holds, anyway.
    ...(options.noReferrer === true ? { referrer: "no-referrer" as const } : {}),
  };
}
