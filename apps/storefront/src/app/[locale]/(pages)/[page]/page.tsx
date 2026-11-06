import { createTranslator, isLocale } from "@fluxkit/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "../../../../components/json-ld";
import { ShopPage } from "../../../../components/shop-page";
import { localizedHref } from "../../../../lib/locale-path";
import { shopPageMetadata } from "../../../../lib/page-metadata";
import { publicOrigin } from "../../../../lib/public-url.server";
import { absoluteUrl, breadcrumbJsonLd } from "../../../../lib/seo";
import { findShopPage } from "../../../../lib/shop-pages";
import { messagesByLocale } from "../../../../messages";

interface ShopPageProps {
  params: Promise<{ locale: string; page: string }>;
}

/**
 * `/{locale}/<slug>`: a shop page of `config/shop-pages.ts` (delivery and payment, returns, FAQ, about, size guide, contacts).
 * A slug that is not listed is a REAL 404: `notFound()` runs before anything streams and no `loading.tsx` sits above this route
 * (`route-structure.spec.ts`). Static routes (`/cart`, `/catalog`, ...) win over this segment.
 */
async function resolve({ params }: ShopPageProps) {
  const { locale, page } = await params;
  if (!isLocale(locale)) notFound();
  const config = findShopPage(page);
  if (config === null) notFound();
  return { locale, config };
}

export async function generateMetadata(props: ShopPageProps): Promise<Metadata> {
  const { locale, config } = await resolve(props);
  return shopPageMetadata({
    origin: await publicOrigin(),
    locale,
    t: createTranslator(messagesByLocale[locale], locale),
    titleKey: config.titleKey,
    descriptionKey: config.descriptionKey,
    slug: config.slug,
  });
}

export default async function ShopPageRoute(props: ShopPageProps) {
  const { locale, config } = await resolve(props);
  const t = createTranslator(messagesByLocale[locale], locale);
  const origin = await publicOrigin();
  return (
    <>
      <ShopPage page={config} locale={locale} t={t} />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: t("breadcrumbs.home"), url: absoluteUrl(origin, localizedHref(locale, "/")) },
          {
            name: t(config.titleKey),
            url: absoluteUrl(origin, localizedHref(locale, `/${config.slug}`)),
          },
        ])}
      />
    </>
  );
}
