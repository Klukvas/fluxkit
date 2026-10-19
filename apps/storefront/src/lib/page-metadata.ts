import type { ProductDetail } from "@fluxkit/api-client";
import { defaultLocale, locales, type Translator } from "@fluxkit/ui";
import type { Metadata } from "next";
import { catalogPath, type CatalogQuery } from "./catalog-query";
import { languageAlternates, listingRobots, socialImageUrl, trimDescription } from "./seo";

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
 * Metadata of a page that belongs to one shopper (cart, checkout, account): a title and `noindex, nofollow`. No canonical
 * and no alternates: the page is not a search result in any language. `robots.txt` keeps crawlers out as well
 * (`lib/robots.ts`); this tag covers a crawler that follows a link anyway.
 */
export function privateMetadata(t: Translator, titleKey: string): Metadata {
  return {
    title: pageTitle(t, t(titleKey)),
    robots: { index: false, follow: false },
  };
}
